require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const Stripe = require('stripe');
const mongoose = require('mongoose');
const User = require('./models/User'); // ✅ Import model MongoDB

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;

// ✅ Conectare MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ✅ CORS
app.use(cors({
    origin: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app',
    credentials: true
}));

app.set('trust proxy', 1);

app.use(session({
    secret: 'secret', 
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { secure: true, sameSite: 'none' },
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 14 * 24 * 60 * 60 // sesiunea expiră după 14 zile
    })
}));

app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((obj, done) => { done(null, obj); });

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'https://swapychat-final.onrender.com/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/login' }),
    (req, res) => {
        res.redirect('https://swapychat-final-git-main-aleanderalexs-projects.vercel.app');
    }
);

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// ✅ Verificăm dacă userul e premium din MongoDB
app.get('/user', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const user = await User.findOne({ email: req.user.emails[0].value });
            const isPremium = user ? user.isPremium : false;
            res.json({ ...req.user, isPremium });
        } catch (err) {
            console.error('❌ Error fetching user:', err);
            res.status(500).send('Server error');
        }
    } else {
        res.json(null);
    }
});

// ✅ Creare checkout Stripe
app.post('/create-checkout-session', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).send('Unauthorized');
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: req.user.emails[0].value,
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: { name: 'SwapyChat Premium Access' },
                unit_amount: 10
            },
            quantity: 1
        }],
        success_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/premium-success',
        cancel_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app'
    });

    res.json({ url: session.url });
});

// ✅ Webhook Stripe securizat
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log('❌ Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_email;

        console.log('✅ Payment confirmed for:', customerEmail);

        // Salvăm utilizatorul ca Premium în MongoDB
        User.findOneAndUpdate(
            { email: customerEmail },
            { isPremium: true },
            { upsert: true, new: true }
        ).then(user => {
            console.log('✅ Premium user saved:', user.email);
        }).catch(err => {
            console.error('❌ Error saving premium user:', err);
        });
    }

    res.sendStatus(200);
});

// ✅ WebSocket Chat
wss.on('connection', (ws) => {
    console.log('New user connected.');

    if (waitingUser === null) {
        waitingUser = ws;
        ws.partner = null;
        ws.send(JSON.stringify({ type: 'waiting' }));
    } else {
        ws.partner = waitingUser;
        waitingUser.partner = ws;

        ws.send(JSON.stringify({ type: 'start' }));
        waitingUser.send(JSON.stringify({ type: 'start' }));

        waitingUser = null;
    }

    ws.on('message', (message) => {
        if (ws.partner) {
            ws.partner.send(message);
        }
    });

    ws.on('close', () => {
        console.log('User disconnected.');
        if (ws.partner) {
            ws.partner.send(JSON.stringify({ type: 'partner-left' }));
            ws.partner.partner = null;
        }
        if (waitingUser === ws) {
            waitingUser = null;
        }
    });
});

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
