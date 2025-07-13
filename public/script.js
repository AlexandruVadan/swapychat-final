let localVideo = document.getElementById('localVideo');
let remoteVideo = document.getElementById('remoteVideo');
let startBtn = document.getElementById('startBtn');
let nextBtn = document.getElementById('nextBtn');
let previousBtn = document.getElementById('previousBtn');
let stopBtn = document.getElementById('stopBtn');
let buyPremiumBtn = document.getElementById('buyPremiumBtn');
let statusMsg = document.getElementById('statusMsg');

let chatContainer = document.getElementById('chatContainer');
let chatMessages = document.getElementById('chatMessages');
let chatInput = document.getElementById('chatInput');
let sendMsgBtn = document.getElementById('sendMsgBtn');
let genderPopup = document.getElementById('genderPopup');
let partnerGenderIcon = document.getElementById('partnerGenderIcon');
let filterSelect = document.getElementById('filterSelect');
let premiumLock = document.getElementById('premiumLock');

let ws;
let localStream;
let peerConnection;

let selectedGender = null;
let previousStream = null;
let isPremiumUser = false;
let isLoggedIn = false;
let premiumUntilDate = null;

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
    genderPopup.style.display = 'flex';

    fetch('https://swapychat-final.onrender.com/user', { credentials: 'include' })
        .then(res => res.json())
        .then(user => {
            if (user) {
                isLoggedIn = true;
                isPremiumUser = user.isPremium || false;
                premiumUntilDate = user.premiumUntil ? new Date(user.premiumUntil) : null;

                document.getElementById('welcomeMsg').innerText =
                    `Welcome, ${user.displayName} ${isPremiumUser ? '🌟 (Premium)' : ''}`;

                document.getElementById('logoutBtn').style.display = 'inline-block';
                document.getElementById('loginBtn').style.display = 'none';

                if (isPremiumUser && premiumUntilDate) {
                    statusMsg.innerText = `🎉 You are a Premium user! Valid until: ${premiumUntilDate.toLocaleDateString()}`;
                    buyPremiumBtn.style.display = 'none';
                    const section = document.getElementById('premiumSection');
                    if (section) section.style.display = 'block';
                } else {
                    statusMsg.innerText = 'Your Premium access has expired or is not active.';
                    buyPremiumBtn.style.display = 'inline-block';
                }

                // ✅ Activăm filtrul dacă e premium
                if (filterSelect && premiumLock) {
                    filterSelect.disabled = !isPremiumUser;
                    premiumLock.style.display = isPremiumUser ? 'none' : 'inline';
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

    const paymentStatus = getQueryParam('payment');
    if (paymentStatus === 'success') {
        showToast('🎉 Congratulations! You now have Premium access!');
    }
};

function selectGender(gender) {
    selectedGender = gender;
    genderPopup.style.display = 'none';
}

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

stopBtn.onclick = () => {
    if (ws) {
        ws.close();
        ws = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    partnerGenderIcon.style.display = 'none';
    statusMsg.innerText = 'Chat stopped. Press Start to begin again.';
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

        const selectedFilter = filterSelect ? filterSelect.value : '';
        ws.send(JSON.stringify({ type: 'init', gender: selectedGender, filter: selectedFilter }));
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
            chatContainer.style.display = 'flex';
            chatMessages.innerHTML = '';
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
            chatContainer.style.display = 'none';
            partnerGenderIcon.style.display = 'none';
            statusMsg.innerText = 'Partner disconnected. Waiting for a new partner...';
        } else if (data.type === 'chat') {
            appendMessage('Partner', data.message);
        } else if (data.type === 'partner-gender') {
            const iconMap = { male: '👨', female: '👩', couple: '👫' };
            const icon = iconMap[data.gender] || '';
            partnerGenderIcon.innerText = icon;
            partnerGenderIcon.style.display = icon ? 'block' : 'none';
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

sendMsgBtn.onclick = () => {
    const msg = chatInput.value.trim();
    if (msg && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', message: msg }));
        appendMessage('You', msg);
        chatInput.value = '';
    }
};

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMsgBtn.click();
});

function appendMessage(sender, message) {
    const msgElem = document.createElement('div');
    msgElem.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(msgElem);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
