let localVideo = document.getElementById('localVideo');
let remoteVideo = document.getElementById('remoteVideo');
let startBtn = document.getElementById('startBtn');
let nextBtn = document.getElementById('nextBtn');
let previousBtn = document.getElementById('previousBtn');
let buyPremiumBtn = document.getElementById('buyPremiumBtn');
let statusMsg = document.getElementById('statusMsg');

let ws;
let localStream;
let peerConnection;

let previousStream = null;
let isPremiumUser = false;
let isLoggedIn = false;

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

window.onload = () => {
    fetch('https://swapychat-final.onrender.com/user', { credentials: 'include' })
        .then(res => res.json())
        .then(user => {
            if (user) {
                isLoggedIn = true;
                isPremiumUser = user.isPremium || false;

                // ✅ Afișăm badge Premium lângă nume
                document.getElementById('welcomeMsg').innerText = `Welcome, ${user.displayName} ${isPremiumUser ? '🌟 (Premium)' : ''}`;

                document.getElementById('logoutBtn').style.display = 'inline-block';
                document.getElementById('loginBtn').style.display = 'none';

                // ✅ Afișăm statusul premium
                if (isPremiumUser) {
                    statusMsg.innerText = '🎉 You are a Premium user!';
                    buyPremiumBtn.style.display = 'none'; // ✅ Ascundem butonul Buy Premium
                } else {
                    statusMsg.innerText = 'Press Start to begin.';
                }

            } else {
                isLoggedIn = false;
                document.getElementById('welcomeMsg').innerText = '';
                document.getElementById('logoutBtn').style.display = 'none';
                document.getElementById('loginBtn').style.display = 'inline-block';
                statusMsg.innerText = 'Press Start to begin.';
            }
        })
        .catch(err => {
            console.error('Fetch error:', err);
            statusMsg.innerText = 'Error connecting to server.';
        });

    document.getElementById('logoutBtn').onclick = () => {
        window.location.href = 'https://swapychat-final.onrender.com/logout';
    };

    // ✅ Detectăm dacă a fost finalizată plata
    const paymentStatus = getQueryParam('payment');
    if (paymentStatus === 'success') {
        showToast('🎉 Congratulations! You now have Premium access!');
    }
};

document.getElementById('loginBtn').onclick = () => {
    const googleClientId = '319429829550-omrq45mmjut5nre4hrp6ubvmb0nmem37.apps.googleusercontent.com';
    const redirectUri = 'https://swapychat-final.onrender.com/auth/google/callback';
    const scope = 'profile email';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
        `?client_id=${googleClientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&access_type=online`;

    window.location.href = authUrl;
};

startBtn.onclick = () => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
        startConnection();
    }
};

nextBtn.onclick = () => {
    if (remoteVideo.srcObject) {
        previousStream = remoteVideo.srcObject;
    }

    if (ws) ws.close();
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    startConnection();
};

previousBtn.onclick = () => {
    if (!isPremiumUser) {
        alert('This feature is available only for premium users.');
        return;
    }

    if (previousStream) {
        remoteVideo.srcObject = previousStream;
        statusMsg.innerText = 'Showing previous partner';
    } else {
        alert('No previous partner available.');
    }
};

buyPremiumBtn.onclick = () => {
    if (!isLoggedIn) {
        alert('Please log in first to buy premium.');
        return;
    }

    fetch('https://swapychat-final.onrender.com/create-checkout-session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(data => {
            window.location.href = data.url;
        })
        .catch(err => console.error('Error creating checkout session:', err));
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

function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.style.display = 'block';

    setTimeout(() => {
        toast.style.display = 'none';
        const url = new URL(window.location);
        url.searchParams.delete('payment');
        window.history.replaceState({}, document.title, url.pathname);
    }, 5000);
}
