const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

dotenv.config();

const app = express();

// ✅ CORS configurat pentru Vercel
app.use(cors({
    origin: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app',
    credentials: true
}));

// ✅ Express-session configurat
app.use(session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// ✅ Google OAuth configurat
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
},
    (accessToken, refreshToken, profile, done) => {
        return done(null, profile);
    }
));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// ✅ Rute pentru Google Login
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile'] })
);

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
    res.json(req.user || null);
});

// ✅ Servim fișierele statice
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Creăm server HTTP și WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;

wss.on('connection', (ws) => {
    if (waitingUser) {
        const partner = waitingUser;
        waitingUser = null;

        ws.partner = partner;
        partner.partner = ws;

        ws.send(JSON.stringify({ type: 'start' }));
        partner.send(JSON.stringify({ type: 'start' }));
    } else {
        waitingUser = ws;
        ws.send(JSON.stringify({ type: 'waiting' }));
    }

    ws.on('message', (message) => {
        if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
            ws.partner.send(message);
        }
    });

    ws.on('close', () => {
        if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
            ws.partner.send(JSON.stringify({ type: 'partner-left' }));
            ws.partner.partner = null;
        }
        if (waitingUser === ws) {
            waitingUser = null;
        }
    });
});

// ✅ Pornim serverul
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
