let localVideo = document.getElementById('localVideo');
let remoteVideo = document.getElementById('remoteVideo');
let startBtn = document.getElementById('startBtn');
let nextBtn = document.getElementById('nextBtn');
let backBtn = document.getElementById('backBtn');
let statusMsg = document.getElementById('statusMsg');
let previousPartner = null;
let isPremium = false;

let ws;
let localStream;
let peerConnection;

const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

const websocketUrl = 'wss://swapychat-final.onrender.com';
let stripe;

// 🔐 Gestionăm login-ul, logout-ul și verificarea premium
window.onload = () => {
    fetch('https://swapychat-final.onrender.com/user', { credentials: 'include' })
        .then(res => res.json())
        .then(user => {
            if (user) {
                document.getElementById('welcomeMsg').innerText = `Welcome, ${user.displayName}`;
                document.getElementById('logoutBtn').style.display = 'inline-block';
                document.getElementById('loginBtn').style.display = 'none';

                // Verificare premium
                fetch('https://swapychat-final.onrender.com/is-premium', { credentials: 'include' })
                    .then(res => res.json())
                    .then(data => {
                        if (data.premium) {
                            isPremium = true;
                            backBtn.style.display = 'inline-block';
                        }
                    });
            } else {
                document.getElementById('welcomeMsg').innerText = '';
                document.getElementById('logoutBtn').style.display = 'none';
                document.getElementById('loginBtn').style.display = 'inline-block';
            }
        });

    document.getElementById('logoutBtn').onclick = () => {
        window.location.href = 'https://swapychat-final.onrender.com/logout';
    };

    // Preluam cheia Stripe
    stripe = Stripe('pk_test_51RhZDSLSfBW6ggYjSObqguaS2wcRAE61dtyj5Fyjg5ZaR4Sg0ettTpsvdHWasX9MQ6YI5NpQQgCIxh3DCAEAds8L00NLvoLox1');
};

startBtn.onclick = () => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
        startConnection();
    }
};

nextBtn.onclick = () => {
    if (ws) ws.close();
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    startConnection();
};

async function startConnection() {
    ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
        console.log('✅ WebSocket connected.');
        statusMsg.innerText = 'Looking for a partner...';
    };

    ws.onmessage = async (event) => {
        let data;

        if (event.data instanceof Blob) {
            const text = await event.data.text();
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error('❌ Error parsing message:', e);
                return;
            }
        } else {
            data = JSON.parse(event.data);
        }

        if (data.type === 'start') {
            console.log('✅ Paired with someone!');
            statusMsg.innerText = 'Connected to partner!';
            startWebRTC();
        } else if (data.type === 'waiting') {
            console.log('Waiting for a partner...');
            statusMsg.innerText = 'Waiting for a partner...';
        } else if (data.type === 'partner-left') {
            alert('Your partner disconnected.');
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            remoteVideo.srcObject = null;
            statusMsg.innerText = 'Partner disconnected. Waiting for a new partner...';
        } else if (data.sdp) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === 'offer') {
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({ sdp: peerConnection.localDescription }));
            }
        } else if (data.ice) {
            try {
                await peerConnection.addIceCandidate(data.ice);
            } catch (e) {
                console.error('Error adding ICE candidate', e);
            }
        }
    };

    ws.onclose = () => {
        console.log('WebSocket closed.');
        statusMsg.innerText = 'Connection closed. Press Start to begin.';
    };
}

async function startWebRTC() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('🎥 Local stream tracks:', localStream.getTracks());
        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(servers);

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            console.log('🎥 Remote stream received:', event.streams[0]);
            remoteVideo.srcObject = event.streams[0];
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ ice: event.candidate }));
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('🌐 ICE connection state:', peerConnection.iceConnectionState);
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ sdp: peerConnection.localDescription }));
    } catch (err) {
        console.error('Error accessing camera: ', err);
        alert('Error accessing camera: ' + err.message);
    }
}

// Reconectare premium
backBtn.onclick = () => {
    fetch('https://swapychat-final.onrender.com/previous-partner', {
        method: 'POST',
        credentials: 'include'
    })
        .then(res => {
            if (res.status === 403) {
                alert('You need to buy premium to use this feature.');
                return;
            }
            if (!res.ok) {
                alert('No previous partner available.');
                return;
            }
            return res.json();
        })
        .then(data => {
            if (data && data.previousPartner) {
                alert('Reconnected to previous partner!');
                // Aici poți să adaugi reconectarea WebRTC dacă vrei.
            }
        });
};

// Stripe payment
document.getElementById('buyPremiumBtn').onclick = () => {
    fetch('https://swapychat-final.onrender.com/create-checkout-session', { method: 'POST' })
        .then(res => res.json())
        .then(session => stripe.redirectToCheckout({ sessionId: session.id }));
};
