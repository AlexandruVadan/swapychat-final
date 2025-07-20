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
const User = require('./models/User');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const waitingUsers = []; // înlocuim waitingUser cu o listă

// ✅ Stripe Webhook
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('✅ Stripe webhook received:', event.type);
    } catch (err) {
        console.log('❌ Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_email;
        const premiumUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 zile

        User.findOneAndUpdate(
            { email: customerEmail },
            { isPremium: true, premiumUntil },
            { upsert: true, new: true }
        ).then(user => {
            console.log('✅ Premium user saved:', user.email);
        }).catch(err => {
            console.error('❌ Error saving premium user:', err);
        });
    }

    res.sendStatus(200);
});

app.use(express.json());

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
        ttl: 14 * 24 * 60 * 60
    })
}));

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

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

app.get('/user', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const user = await User.findOne({ email: req.user.emails[0].value });

            let isPremium = false;
            let premiumUntil = null;

            if (user?.premiumUntil && new Date(user.premiumUntil) > new Date()) {
                isPremium = true;
                premiumUntil = user.premiumUntil;
            } else if (user?.isPremium) {
                await User.findOneAndUpdate({ email: user.email }, { isPremium: false });
            }

            res.json({ ...req.user, isPremium, premiumUntil });
        } catch (err) {
            console.error('❌ Error fetching user:', err);
            res.status(500).send('Server error');
        }
    } else {
        res.json(null);
    }
});

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
                product_data: { name: 'SwapyChat Premium Access (30 days)' },
                unit_amount: 200
            },
            quantity: 1
        }],
        success_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/?payment=success',
        cancel_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app'
    });

    res.json({ url: session.url });
});

// ✅ WebSocket matchmaking
wss.on('connection', (ws) => {
    console.log('New user connected.');
    ws.partner = null;
    ws.gender = null;
    ws.filter = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON:', e);
            return;
        }

        if (data.type === 'init') {
            ws.gender = data.gender;
            ws.filter = data.filter || null;

            // încearcă să găsești un partener compatibil//
            const index = waitingUsers.findIndex(user => {
                return (!ws.filter || user.gender === ws.filter) &&
                       (!user.filter || ws.gender === user.filter);
            });

            if (index !== -1) {
                const partner = waitingUsers.splice(index, 1)[0];
                ws.partner = partner;
                partner.partner = ws;

                ws.send(JSON.stringify({ type: 'start' }));
                partner.send(JSON.stringify({ type: 'start' }));

                ws.send(JSON.stringify({ type: 'partner-gender', gender: partner.gender }));
                partner.send(JSON.stringify({ type: 'partner-gender', gender: ws.gender }));
            } else {
                waitingUsers.push(ws);
                ws.send(JSON.stringify({ type: 'waiting' }));
            }
        } else if (data.type === 'chat' || data.sdp || data.ice) {
            if (ws.partner) {
                ws.partner.send(message);
            }
        }
    });

    ws.on('close', () => {
        console.log('User disconnected.');
        if (ws.partner) {
            ws.partner.send(JSON.stringify({ type: 'partner-left' }));
            ws.partner.partner = null;
        }
        const i = waitingUsers.indexOf(ws);
        if (i !== -1) waitingUsers.splice(i, 1);
    });
});

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
