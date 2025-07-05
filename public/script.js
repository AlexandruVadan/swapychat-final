let localVideo = document.getElementById('localVideo');
let remoteVideo = document.getElementById('remoteVideo');
let startBtn = document.getElementById('startBtn');
let nextBtn = document.getElementById('nextBtn');
let statusMsg = document.getElementById('statusMsg');

let ws;
let localStream;
let peerConnection;

const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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

// 🔐 Gestionăm login-ul și logout-ul
window.onload = () => {
    fetch('/user')
        .then(res => res.json())
        .then(user => {
            if (user) {
                document.getElementById('welcomeMsg').innerText = `Welcome, ${user.displayName}`;
                document.getElementById('logoutBtn').style.display = 'inline-block';
                document.getElementById('loginBtn').style.display = 'none';
            } else {
                document.getElementById('welcomeMsg').innerText = '';
                document.getElementById('logoutBtn').style.display = 'none';
                document.getElementById('loginBtn').style.display = 'inline-block';
            }
        });

    document.getElementById('logoutBtn').onclick = () => {
        window.location.href = '/logout';
    };
};

async function startConnection() {
    ws = new WebSocket('ws://' + window.location.host);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        statusMsg.innerText = 'Looking for a partner...';
    };

    ws.onmessage = async (event) => {
        let data = JSON.parse(event.data);

        if (data.type === 'start') {
            console.log('Paired with someone!');
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
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(servers);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ ice: event.candidate }));
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({ sdp: peerConnection.localDescription }));
}
