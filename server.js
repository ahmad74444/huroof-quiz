const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ===== Health Check =====
app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

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
    socket.on('create-room', ({ team1Name, team2Name, maxQuestions, enableSection1, enableSection2 }) => {
        let code = generateRoomCode();
        while (rooms[code]) code = generateRoomCode();

        rooms[code] = {
            host: socket.id,
            enableSection1: enableSection1 !== false,
            enableSection2: enableSection2 !== false,
            currentSection: (enableSection1 !== false) ? 1 : 2,
            team1: { name: team1Name || '', score: 0 },
            team2: { name: team2Name || '', score: 0 },
            players: [],
            playerScores: {},
            usedLetters: [],
            currentQuestion: '',
            currentAnswer: '',
            currentLetter: '',
            buzzedTeam: null,
            buzzedPlayerId: null,
            secondChance: false,
            secondChanceExcluded: [],
            questionCount: 0,
            maxQuestions: maxQuestions || 10,
            choosingTeam: null,
            choosingPlayerId: null,
            gameStarted: false,
            buzzersLocked: false
        };

        socket.join(code);
        socket.roomCode = code;
        socket.isHost = true;

        socket.emit('room-created', { code });
        console.log(`Room ${code} created by ${socket.id} (S1:${rooms[code].enableSection1} S2:${rooms[code].enableSection2})`);
    });

    // ===== Check Room (for player pre-join info) =====
    socket.on('check-room', ({ code }) => {
        code = (code || '').toUpperCase().trim();
        const room = rooms[code];
        if (!room) {
            socket.emit('room-info', { exists: false });
        } else {
            socket.emit('room-info', {
                exists: true,
                enableSection2: room.enableSection2,
                team1Name: room.team1.name,
                team2Name: room.team2.name
            });
        }
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
        socket.playerTeam = team || 1;

        room.players.push({
            id: socket.id,
            name: playerName,
            team: socket.playerTeam
        });

        // Track individual scores (for section 1)
        room.playerScores[socket.id] = { name: playerName, score: 0 };

        socket.emit('joined-room', {
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            team: socket.playerTeam,
            gameStarted: room.gameStarted,
            currentSection: room.currentSection,
            enableSection1: room.enableSection1,
            enableSection2: room.enableSection2
        });

        // Notify host
        io.to(room.host).emit('player-joined', {
            playerName,
            team: socket.playerTeam,
            players: room.players
        });

        console.log(`${playerName} joined room ${code} team ${socket.playerTeam}`);
    });

    // ===== Start Game =====
    socket.on('start-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.gameStarted = true;
        room.currentSection = 1;
        room.questionCount = 0;
        room.team1.score = 0;
        room.team2.score = 0;
        for (const id in room.playerScores) {
            room.playerScores[id].score = 0;
        }

        io.to(socket.roomCode).emit('game-started', {
            currentSection: 1,
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
        room.buzzedPlayerId = null;
        room.secondChance = false;
        room.secondChanceExcluded = [];
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
            currentSection: room.currentSection,
            team1Score: room.team1.score,
            team2Score: room.team2.score,
            playerScores: room.playerScores
        });
    });

    // ===== Player Buzzes =====
    socket.on('buzz', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.buzzersLocked) return;

        if (room.currentSection === 1) {
            // General mode: any player can buzz
            if (room.buzzedPlayerId) return;
            if (room.secondChanceExcluded.includes(socket.id)) return;
            room.buzzedPlayerId = socket.id;
            room.buzzersLocked = true;

            io.to(socket.roomCode).emit('player-buzzed', {
                playerName: socket.playerName,
                playerId: socket.id,
                team: 0,
                teamName: socket.playerName,
                currentSection: 1
            });
        } else {
            // Teams mode: only one team can buzz
            if (room.buzzedTeam) return;
            room.buzzedTeam = socket.playerTeam;
            room.buzzedPlayerId = socket.id;
            room.buzzersLocked = true;

            io.to(socket.roomCode).emit('player-buzzed', {
                playerName: socket.playerName,
                team: socket.playerTeam,
                teamName: socket.playerTeam === 1 ? room.team1.name : room.team2.name,
                currentSection: 2
            });
        }
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
        if (!room || room.host !== socket.id) return;

        if (room.currentSection === 1) {
            // General mode
            if (!room.buzzedPlayerId) return;
            const winnerId = room.buzzedPlayerId;
            if (room.playerScores[winnerId]) {
                room.playerScores[winnerId].score++;
            }
            room.choosingPlayerId = winnerId;

            io.to(socket.roomCode).emit('answer-correct', {
                currentSection: 1,
                playerId: winnerId,
                playerName: room.playerScores[winnerId]?.name || 'متسابق',
                answer: room.currentAnswer,
                playerScores: room.playerScores,
                choosingPlayerId: winnerId
            });

            // Also send score update
            io.to(room.host).emit('score-updated', {
                playerScores: room.playerScores
            });
        } else {
            // Teams mode
            if (!room.buzzedTeam) return;
            const winningTeam = room.buzzedTeam;
            if (winningTeam === 1) room.team1.score++;
            else room.team2.score++;

            room.choosingTeam = winningTeam;
            const isGameOver = room.questionCount >= room.maxQuestions;

            io.to(socket.roomCode).emit('answer-correct', {
                currentSection: 2,
                team: winningTeam,
                teamName: winningTeam === 1 ? room.team1.name : room.team2.name,
                answer: room.currentAnswer,
                team1Score: room.team1.score,
                team2Score: room.team2.score,
                choosingTeam: winningTeam,
                isGameOver
            });
        }
    });

    // ===== Host Judges Wrong =====
    socket.on('judge-wrong', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        if (room.currentSection === 1) {
            // General mode: exclude this player, open buzzers for rest
            room.secondChanceExcluded.push(room.buzzedPlayerId);
            room.buzzedPlayerId = null;
            room.buzzersLocked = false;

            const remainingPlayers = room.players.filter(p => !room.secondChanceExcluded.includes(p.id));
            if (remainingPlayers.length === 0) {
                // All players failed
                io.to(socket.roomCode).emit('both-wrong', {
                    answer: room.currentAnswer,
                    playerScores: room.playerScores,
                    currentSection: 1
                });

                // Also notify host
                io.to(room.host).emit('all-players-wrong');
            } else {
                io.to(socket.roomCode).emit('second-chance', {
                    currentSection: 1,
                    excludedPlayers: room.secondChanceExcluded
                });
            }
        } else {
            // Teams mode
            if (!room.secondChance) {
                room.secondChance = true;
                room.buzzersLocked = false;
                const wrongTeam = room.buzzedTeam;
                room.buzzedTeam = null;
                const otherTeam = wrongTeam === 1 ? 2 : 1;

                io.to(socket.roomCode).emit('second-chance', {
                    currentSection: 2,
                    wrongTeam,
                    team: otherTeam,
                    teamName: otherTeam === 1 ? room.team1.name : room.team2.name
                });
            } else {
                const isGameOver = room.questionCount >= room.maxQuestions;
                io.to(socket.roomCode).emit('both-wrong', {
                    answer: room.currentAnswer,
                    team1Score: room.team1.score,
                    team2Score: room.team2.score,
                    currentSection: 2,
                    isGameOver
                });
            }
        }
    });

    // ===== Host Skips =====
    socket.on('skip-question', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        const isGameOver = room.currentSection === 2 && room.questionCount >= room.maxQuestions;

        io.to(socket.roomCode).emit('question-skipped', {
            answer: room.currentAnswer,
            team1Score: room.team1.score,
            team2Score: room.team2.score,
            playerScores: room.playerScores,
            currentSection: room.currentSection,
            isGameOver
        });
    });

    // ===== Switch Section (Section 1 -> Section 2) =====
    socket.on('switch-section', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.currentSection = 2;
        room.questionCount = 0;
        room.team1.score = 0;
        room.team2.score = 0;
        room.usedLetters = [];
        room.choosingTeam = null;
        room.choosingPlayerId = null;

        io.to(socket.roomCode).emit('section-switched', {
            currentSection: 2,
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            maxQuestions: room.maxQuestions
        });
    });

    // ===== Start Section 2 (after transition screen) =====
    socket.on('start-section2', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        io.to(socket.roomCode).emit('section2-started', {
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            maxQuestions: room.maxQuestions
        });
    });

    // ===== Play Sound (broadcast to all players) =====
    socket.on('play-sound', ({ sound }) => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        io.to(socket.roomCode).emit('play-sound', { sound });
    });

    // ===== Player Chooses Letter =====
    socket.on('choose-letter', ({ letter }) => {
        const room = rooms[socket.roomCode];
        if (!room) return;

        const allowed = socket.isHost ||
            (room.currentSection === 1 && socket.id === room.choosingPlayerId) ||
            (room.currentSection === 2 && socket.playerTeam === room.choosingTeam);

        if (allowed) {
            io.to(socket.roomCode).emit('letter-chosen', {
                letter,
                chosenBy: socket.playerName || 'المسؤول',
                team: room.choosingTeam
            });

            io.to(room.host).emit('load-letter-question', { letter });
        }
    });

    // ===== End Game =====
    socket.on('end-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        io.to(socket.roomCode).emit('game-ended', {
            currentSection: room.currentSection,
            team1Name: room.team1.name,
            team2Name: room.team2.name,
            team1Score: room.team1.score,
            team2Score: room.team2.score,
            playerScores: room.playerScores
        });
    });

    // ===== New Game (reset) =====
    socket.on('new-game', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.host !== socket.id) return;

        room.currentSection = 1;
        room.team1.score = 0;
        room.team2.score = 0;
        room.usedLetters = [];
        room.questionCount = 0;
        room.gameStarted = false;
        room.choosingTeam = null;
        room.choosingPlayerId = null;
        for (const id in room.playerScores) {
            room.playerScores[id].score = 0;
        }

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
