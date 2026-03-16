const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ===== Get Local Network IP =====
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// ===== API: Get server info for clients =====
app.get('/api/server-info', (req, res) => {
    res.json({ ip: getLocalIP(), port: PORT });
});

// ===== Room Storage =====
const rooms = {};

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // ===== Create Room =====
    socket.on('create-room', ({ team1Name, team2Name, maxQuestions }) => {
        let code = generateRoomCode();
        while (rooms[code]) code = generateRoomCode();

        rooms[code] = {
            host: socket.id,
            team1: { name: team1Name, score: 0 },
            team2: { name: team2Name, score: 0 },
            players: [],
            usedLetters: [],
            currentQuestion: '',
            currentAnswer: '',
            currentLetter: '',
            buzzedTeam: null,
            secondChance: false,
            questionCount: 0,
            maxQuestions: maxQuestions || 10,
            choosingTeam: null,
            gameStarted: false,
            buzzersLocked: false
        };

        socket.join(code);
        socket.roomCode = code;
        socket.isHost = true;

        socket.emit('room-created', { code });
        console.log(`Room ${code} created by ${socket.id}`);
    });

    // ===== Join Room =====
    socket.on('join-room', ({ code, playerName, team }) => {
        code = code.toUpperCase().trim();
        const room = rooms[code];
        if (!room) {
            socket.emit('join-error', 'لم يتم العثور على الغرفة. تأكد من الرمز.');
            return;
        }

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = playerName;
        socket.playerTeam = team;

        room.players.push({
            id: socket.id,
            name: playerName,
            team: team
        });

        socket.emit('joined-room', {
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            team: team,
            gameStarted: room.gameStarted
        });

        // Notify host
        io.to(room.host).emit('player-joined', {
            playerName,
            team,
            players: room.players
        });

        console.log(`${playerName} joined room ${code} as team ${team}`);
    });

    // ===== Start Game =====
    socket.on('start-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.gameStarted = true;
        room.questionCount = 0;
        room.team1.score = 0;
        room.team2.score = 0;

        io.to(socket.roomCode).emit('game-started', {
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            maxQuestions: room.maxQuestions
        });
    });

    // ===== Host Sends Question =====
    socket.on('send-question', ({ letter, question, answer }) => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.currentLetter = letter;
        room.currentQuestion = question;
        room.currentAnswer = answer;
        room.buzzedTeam = null;
        room.secondChance = false;
        room.buzzersLocked = false;
        room.questionCount++;

        if (!room.usedLetters.includes(letter)) {
            room.usedLetters.push(letter);
        }

        io.to(socket.roomCode).emit('question-shown', {
            letter,
            question,
            questionNumber: room.questionCount,
            maxQuestions: room.maxQuestions,
            team1Score: room.team1.score,
            team2Score: room.team2.score
        });
    });

    // ===== Player Buzzes =====
    socket.on('buzz', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.buzzersLocked || room.buzzedTeam) return;

        room.buzzedTeam = socket.playerTeam;
        room.buzzersLocked = true;

        io.to(socket.roomCode).emit('player-buzzed', {
            playerName: socket.playerName,
            team: socket.playerTeam,
            teamName: socket.playerTeam === 1 ? room.team1.name : room.team2.name
        });
    });

    // ===== Host Shows Answer =====
    socket.on('show-answer', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        io.to(socket.roomCode).emit('answer-revealed', {
            answer: room.currentAnswer
        });
    });

    // ===== Host Judges Correct =====
    socket.on('judge-correct', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id || !room.buzzedTeam) return;

        const winningTeam = room.buzzedTeam;
        if (winningTeam === 1) room.team1.score++;
        else room.team2.score++;

        const isGameOver = room.questionCount >= room.maxQuestions;

        io.to(socket.roomCode).emit('answer-correct', {
            team: winningTeam,
            teamName: winningTeam === 1 ? room.team1.name : room.team2.name,
            answer: room.currentAnswer,
            team1Score: room.team1.score,
            team2Score: room.team2.score,
            choosingTeam: winningTeam,
            isGameOver
        });

        room.choosingTeam = winningTeam;
    });

    // ===== Host Judges Wrong =====
    socket.on('judge-wrong', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        if (!room.secondChance) {
            // First wrong answer - give other team a chance
            room.secondChance = true;
            room.buzzersLocked = false;
            const wrongTeam = room.buzzedTeam;
            room.buzzedTeam = null;
            const otherTeam = wrongTeam === 1 ? 2 : 1;

            io.to(socket.roomCode).emit('second-chance', {
                wrongTeam,
                team: otherTeam,
                teamName: otherTeam === 1 ? room.team1.name : room.team2.name
            });
        } else {
            // Both teams failed
            const isGameOver = room.questionCount >= room.maxQuestions;

            io.to(socket.roomCode).emit('both-wrong', {
                answer: room.currentAnswer,
                team1Score: room.team1.score,
                team2Score: room.team2.score,
                isGameOver
            });
        }
    });

    // ===== Host Skips =====
    socket.on('skip-question', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        const isGameOver = room.questionCount >= room.maxQuestions;

        io.to(socket.roomCode).emit('question-skipped', {
            answer: room.currentAnswer,
            team1Score: room.team1.score,
            team2Score: room.team2.score,
            isGameOver
        });
    });

    // ===== Player Chooses Letter =====
    socket.on('choose-letter', ({ letter }) => {
        const room = rooms[socket.roomCode];
        if (!room) return;

        // Only allow the choosing team's players or the host
        if (socket.isHost || socket.playerTeam === room.choosingTeam) {
            io.to(socket.roomCode).emit('letter-chosen', {
                letter,
                chosenBy: socket.playerName || 'المسؤول',
                team: room.choosingTeam
            });

            // Notify host specifically to load question
            io.to(room.host).emit('load-letter-question', { letter });
        }
    });

    // ===== End Game =====
    socket.on('end-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        io.to(socket.roomCode).emit('game-ended', {
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            team1Score: room.team1.score,
            team2Score: room.team2.score
        });
    });

    // ===== New Game (reset) =====
    socket.on('new-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.team1.score = 0;
        room.team2.score = 0;
        room.usedLetters = [];
        room.questionCount = 0;
        room.gameStarted = false;
        room.choosingTeam = null;

        io.to(socket.roomCode).emit('game-reset');
    });

    // ===== Disconnect =====
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;

        if (socket.isHost) {
            io.to(code).emit('host-disconnected');
            delete rooms[code];
            console.log(`Room ${code} deleted (host left)`);
        } else {
            rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
            if (rooms[code].host) {
                io.to(rooms[code].host).emit('player-left', {
                    playerName: socket.playerName,
                    players: rooms[code].players
                });
            }
        }
        console.log('Disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
const isProduction = process.env.RENDER || process.env.NODE_ENV === 'production';

server.listen(PORT, '0.0.0.0', () => {
    if (isProduction) {
        console.log(`مسابقة حروف - Server running on port ${PORT}`);
    } else {
        const localIP = getLocalIP();
        const localUrl = `http://localhost:${PORT}`;
        const networkUrl = `http://${localIP}:${PORT}`;

        console.log(`\n  ╔══════════════════════════════════════════╗`);
        console.log(`  ║        مسابقة حروف - Server running      ║`);
        console.log(`  ╠══════════════════════════════════════════╣`);
        console.log(`  ║  Local:   ${localUrl.padEnd(30)}║`);
        console.log(`  ║  Network: ${networkUrl.padEnd(30)}║`);
        console.log(`  ║  Player:  ${(networkUrl + '/player.html').padEnd(30)}║`);
        console.log(`  ╚══════════════════════════════════════════╝\n`);

        // Auto-open browser (local only)
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32' ? 'start' :
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} ${localUrl}`);
    }
});
