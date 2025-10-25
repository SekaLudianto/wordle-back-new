require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const { TikTokConnectionWrapper, getGlobalConnectionCount } = require('./connectionWrapper');
const { clientBlocked } = require('./limiter');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    let tiktokConnectionWrapper;
    console.info('New connection from', socket.handshake.headers['origin'] || socket.handshake.headers['referer']);

    socket.on('setUniqueId', (uniqueId, options = {}) => {
        delete options.requestOptions;
        delete options.websocketOptions;

        if (process.env.SESSIONID) {
            options.sessionId = process.env.SESSIONID;
            console.info('Using SessionId');
        }

        if (process.env.ENABLE_RATE_LIMIT && clientBlocked(io, socket)) {
            socket.emit('tiktokDisconnected', 'Rate limit reached');
            return;
        }

        try {
            tiktokConnectionWrapper = new TikTokConnectionWrapper(uniqueId, options, true);
            tiktokConnectionWrapper.connect();
        } catch (err) {
            socket.emit('tiktokDisconnected', err.toString());
            return;
        }

        tiktokConnectionWrapper.once('connected', s => socket.emit('tiktokConnected', s));
        tiktokConnectionWrapper.once('disconnected', r => socket.emit('tiktokDisconnected', r));

        const c = tiktokConnectionWrapper.connection;
        c.on('streamEnd', () => socket.emit('streamEnd'));
        [
            'roomUser','member','chat','gift','social','like',
            'questionNew','linkMicBattle','linkMicArmies','liveIntro','emote','envelope','subscribe'
        ].forEach(evt => c.on(evt, msg => socket.emit(evt, msg)));
    });

    socket.on('disconnect', () => {
        if (tiktokConnectionWrapper) tiktokConnectionWrapper.disconnect();
    });
});

// statistik global
setInterval(() => {
    io.emit('statistic', { globalConnectionCount: getGlobalConnectionCount() });
}, 5000);

// serve root
app.get('/', (req, res) => res.send('TikTok Live backend aktif'));

// auto-ping (Render anti sleep)
if (process.env.RENDER_URL) {
    setInterval(() => {
        fetch(process.env.RENDER_URL).catch(() => {});
    }, 4 * 60 * 1000); // 4 menit
}

const port = process.env.PORT || 8081;
httpServer.listen(port, () => console.info(`Server running on port ${port}`));
