// === server.js complet cu Stripe si Webhook configurat ===
require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Stripe = require('stripe');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Pentru webhook
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

let waitingUser = null;
const userSessions = new Map(); // Salvam partenerii anteriori
const premiumUsers = new Set(); // In memorie: userId -> premium

// === Configurare sesiune si Passport ===
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// === Google OAuth ===
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// === Rute Autentificare ===
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

app.get('/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json(req.user);
    } else {
        res.json(null);
    }
});

app.get('/is-premium', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.json({ premium: false });
    }
    const userId = req.session.passport.user.id;
    res.json({ premium: premiumUsers.has(userId) });
});

// === Stripe Payment ===
app.post('/create-checkout-session', async (req, res) => {
    const sessionStripe = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: { name: 'SwapyChat Premium' },
                unit_amount: 199,
            },
            quantity: 1
        }],
        success_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/success.html',
        cancel_url: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app/cancel.html'
    });

    res.json({ id: sessionStripe.id });
});

// === Webhook Stripe ===
app.post('/webhook', (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log('❌ Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        console.log('✅ Payment confirmed.');
        // Exemplu: salvam premium pentru un user hardcodat (ideal: extragi din metadata sau email)
        // In productie trebuie sa legi sesiunile Stripe de userii autentificati
        // Exemplu: premiumUsers.add(userId);
    }

    res.json({ received: true });
});

// === Reconectare Partener Precedent ===
app.post('/previous-partner', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = req.session.passport.user.id;

    if (!premiumUsers.has(userId)) {
        return res.status(403).json({ error: 'Premium required' });
    }

    const sessionData = userSessions.get(userId);

    if (!sessionData || !sessionData.previousPartner) {
        return res.status(404).json({ error: 'No previous partner' });
    }

    res.json({ previousPartner: sessionData.previousPartner });
});

// === WebSocket ===
wss.on('connection', (ws, req) => {
    if (!req.session || !req.session.passport || !req.session.passport.user) {
        ws.close();
        return;
    }

    const userId = req.session.passport.user.id;
    userSessions.set(userId, { ws, previousPartner: null });

    console.log(`User connected: ${userId}`);

    if (waitingUser === null) {
        waitingUser = ws;
        ws.partner = null;
        ws.userId = userId;
        ws.send(JSON.stringify({ type: 'waiting' }));
    } else {
        ws.partner = waitingUser;
        ws.userId = userId;

        waitingUser.partner = ws;

        const previousUserId = waitingUser.userId;

        if (userSessions.has(userId)) {
            userSessions.get(userId).previousPartner = previousUserId;
        }
        if (userSessions.has(previousUserId)) {
            userSessions.get(previousUserId).previousPartner = userId;
        }

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
        console.log(`User disconnected: ${userId}`);
        if (ws.partner) {
            ws.partner.send(JSON.stringify({ type: 'partner-left' }));
            ws.partner.partner = null;
        }
        if (waitingUser === ws) {
            waitingUser = null;
        }
        userSessions.delete(userId);
    });
});

// === Servim Frontend ===
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
