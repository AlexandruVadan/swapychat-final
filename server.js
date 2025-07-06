require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;
let premiumUsers = []; // ✅ Simulăm baza de date cu email-uri premium

// ✅ CORS corect
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
    cookie: {
        secure: true,
        sameSite: 'none'
    }
}));

app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

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

app.get('/user', (req, res) => {
    if (req.isAuthenticated()) {
        const isPremium = premiumUsers.includes(req.user.emails[0].value);
        res.json({ ...req.user, isPremium });
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
                product_data: { name: 'SwapyChat Premium Access' },
                unit_amount: 500
            },
            quantity: 1
        }],
        success_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/premium-success',
        cancel_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app'
    });

    res.json({ url: session.url });
});

app.post('/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
    let event;

    try {
        event = JSON.parse(req.body);
    } catch (err) {
        console.log('Webhook error:', err);
        return res.sendStatus(400);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_email;

        console.log('✅ Payment confirmed for:', customerEmail);

        if (!premiumUsers.includes(customerEmail)) {
            premiumUsers.push(customerEmail);
        }
    }

    res.sendStatus(200);
});

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
