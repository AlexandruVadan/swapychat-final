require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;

// ✅ CORS corect
app.use(cors({
    origin: 'https://swapychat-final-git-main-aleanderalexs-projects.vercel.app',
    credentials: true
}));

// ✅ Recomandat pe Render (HTTPS proxy)
app.set('trust proxy', 1);

// ✅ Configurare sesiune corectă
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: false,
    proxy: true, // ✅ esențial pe Render
    cookie: {
        secure: true,       // ✅ obligă HTTPS
        sameSite: 'none'    // ✅ permite cross-origin cookies
    }
}));

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
        res.json(req.user);
    } else {
        res.json(null);
    }
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

// Servim frontend local dacă e cazul 
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
