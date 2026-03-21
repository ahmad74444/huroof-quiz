/* ===== مسابقة حروف - Player Logic (Two Sections) ===== */

let socket;
try {
    socket = io();
    socket.on('connect', () => {
        console.log('متصل بالسيرفر:', socket.id);
    });
    socket.on('connect_error', () => {
        alert('تعذر الاتصال بالسيرفر!\n\nافتح الصفحة من:\nhttp://localhost:3000/player.html');
    });
} catch (e) {
    alert('تعذر الاتصال بالسيرفر!\n\nافتح الصفحة من:\nhttp://localhost:3000/player.html');
}

// ===== State =====
const pState = {
    myTeam: 0,
    currentSection: 1,
    team1Name: '',
    team2Name: '',
    team1Score: 0,
    team2Score: 0,
    playerScores: {},
    canBuzz: false,
    usedLetters: []
};

const ARABIC_LETTERS = [
    'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ',
    'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص',
    'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق',
    'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'
];

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const screens = {
    join: $('join-screen'),
    waiting: $('waiting-screen'),
    game: $('player-game-screen'),
    letterChoice: $('player-letter-screen'),
    waitLetter: $('player-wait-letter-screen'),
    transition: $('player-transition-screen'),
    results: $('player-results-screen')
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// ===== Sound =====
let audioCtx = null;
function playTone(freq, dur, type = 'square', vol = 0.15) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = type;
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    } catch (e) {}
}

function playBuzzSound() {
    playTone(220, 0.15, 'sawtooth', 0.2);
    setTimeout(() => playTone(330, 0.15, 'sawtooth', 0.2), 80);
}

function playWinnerSound() {
    [523, 587, 659, 784, 880, 1047].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.2, 'sine', 0.15), i * 120);
    });
}

function playLoseSound() {
    playTone(440, 0.3, 'sine', 0.15);
    setTimeout(() => playTone(370, 0.3, 'sine', 0.15), 300);
    setTimeout(() => playTone(330, 0.3, 'sine', 0.15), 600);
    setTimeout(() => playTone(262, 0.5, 'sine', 0.15), 900);
}

function playApplauseSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = audioCtx;
        const duration = 3;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            const t = i / ctx.sampleRate;
            const envelope = Math.sin(Math.PI * t / duration) * 0.3;
            data[i] = (Math.random() * 2 - 1) * envelope * (0.5 + 0.5 * Math.sin(t * 8));
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2000;
        filter.Q.value = 0.5;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
    } catch (e) {}
}

// ===== Auto-fill room code from URL =====
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
        $('room-code-input').value = roomCode.toUpperCase();
    }
    $('room-code-input').focus();
});

// ===== Team Selection =====
$('select-team1').addEventListener('click', () => selectTeam(1));
$('select-team2').addEventListener('click', () => selectTeam(2));

function selectTeam(team) {
    $('selected-team').value = team;
    $('select-team1').classList.toggle('selected', team === 1);
    $('select-team2').classList.toggle('selected', team === 2);
}

// ===== Join Room =====
$('join-btn').addEventListener('click', () => {
    const code = $('room-code-input').value.trim().toUpperCase();
    const name = $('player-name-input').value.trim();
    const team = parseInt($('selected-team').value);

    if (!code) { showJoinError('أدخل رمز الغرفة'); return; }
    if (!name) { showJoinError('أدخل اسمك'); return; }
    if (!team) { showJoinError('اختر فريقك'); return; }

    $('join-error').hidden = true;
    socket.emit('join-room', { code, playerName: name, team });
});

function showJoinError(msg) {
    $('join-error').textContent = msg;
    $('join-error').hidden = false;
}

socket.on('join-error', (msg) => {
    showJoinError(msg);
});

socket.on('joined-room', ({ team1Name, team2Name, team, gameStarted, currentSection }) => {
    pState.myTeam = team;
    pState.currentSection = currentSection || 1;
    pState.team1Name = team1Name;
    pState.team2Name = team2Name;

    $('team1-label').textContent = team1Name;
    $('team2-label').textContent = team2Name;
    $('my-team-name').textContent = team === 1 ? team1Name : team2Name;

    // Set team names everywhere
    $('p-team1-name').textContent = team1Name;
    $('p-team2-name').textContent = team2Name;
    $('pl-team1-name').textContent = team1Name;
    $('pl-team2-name').textContent = team2Name;
    $('p-result-team1-name').textContent = team1Name;
    $('p-result-team2-name').textContent = team2Name;

    if (gameStarted) {
        showScreen('game');
    } else {
        showScreen('waiting');
    }
});

// ===== Update Section Indicator =====
function updateSectionIndicator() {
    const el = $('p-section-indicator');
    if (!el) return;
    if (pState.currentSection === 1) {
        el.textContent = '📢 عام';
        el.className = 'current-section-badge-sm section-1';
    } else {
        el.textContent = '👥 فريقين';
        el.className = 'current-section-badge-sm section-2';
    }
}

// ===== Update Scoreboard =====
function updatePlayerScores() {
    if (pState.currentSection === 1) {
        // Show top players in scoreboard
        const sorted = Object.values(pState.playerScores)
            .sort((a, b) => b.score - a.score);

        const scoreboardEl = $('p-scoreboard');
        if (scoreboardEl) {
            scoreboardEl.innerHTML = sorted.slice(0, 3).map((p, i) =>
                `<div class="score-item"><span class="score-team-name" style="color: var(--gold-light);">${['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] || ''} ${p.name}</span><span class="score-value" style="color: var(--gold);">${p.score}</span></div>`
            ).join('<div class="score-divider" aria-hidden="true">|</div>') || '';
        }

        const plScoreboard = $('pl-scoreboard');
        if (plScoreboard) {
            plScoreboard.innerHTML = sorted.slice(0, 3).map((p, i) =>
                `<div class="score-item"><span class="score-team-name" style="color: var(--gold-light);">${['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] || ''} ${p.name}</span><span class="score-value" style="color: var(--gold);">${p.score}</span></div>`
            ).join('<div class="score-divider" aria-hidden="true">|</div>') || '';
        }
    } else {
        const scoreboardEl = $('p-scoreboard');
        if (scoreboardEl) {
            scoreboardEl.innerHTML = `
                <div class="score-item team1-score">
                    <span class="score-team-name" id="p-team1-name">${pState.team1Name}</span>
                    <span class="score-value" id="p-team1-score">${pState.team1Score}</span>
                </div>
                <div class="score-divider">:</div>
                <div class="score-item team2-score">
                    <span class="score-value" id="p-team2-score">${pState.team2Score}</span>
                    <span class="score-team-name" id="p-team2-name">${pState.team2Name}</span>
                </div>
            `;
        }

        const plScoreboard = $('pl-scoreboard');
        if (plScoreboard) {
            plScoreboard.innerHTML = `
                <div class="score-item team1-score">
                    <span class="score-team-name" id="pl-team1-name">${pState.team1Name}</span>
                    <span class="score-value" id="pl-team1-score">${pState.team1Score}</span>
                </div>
                <div class="score-divider">:</div>
                <div class="score-item team2-score">
                    <span class="score-value" id="pl-team2-score">${pState.team2Score}</span>
                    <span class="score-team-name" id="pl-team2-name">${pState.team2Name}</span>
                </div>
            `;
        }
    }
}

// ===== Game Started =====
socket.on('game-started', ({ currentSection, team1Name, team2Name, maxQuestions }) => {
    pState.currentSection = currentSection || 1;
    pState.team1Name = team1Name;
    pState.team2Name = team2Name;
    pState.team1Score = 0;
    pState.team2Score = 0;
    pState.playerScores = {};
    pState.usedLetters = [];
    updateSectionIndicator();
    updatePlayerScores();

    showScreen('waitLetter');
    $('wait-letter-title').textContent = 'المسؤول يختار الحرف الأول...';
});

// ===== Question Shown =====
socket.on('question-shown', ({ letter, question, questionNumber, maxQuestions, currentSection, team1Score, team2Score, playerScores }) => {
    pState.currentSection = currentSection || pState.currentSection;
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    if (playerScores) pState.playerScores = playerScores;
    pState.canBuzz = true;

    if (!pState.usedLetters.includes(letter)) {
        pState.usedLetters.push(letter);
    }

    $('p-current-letter').textContent = letter;
    if (pState.currentSection === 1) {
        $('p-question-counter').textContent = `السؤال ${questionNumber}`;
    } else {
        $('p-question-counter').textContent = `السؤال ${questionNumber} من ${maxQuestions}`;
    }
    $('p-question-text').textContent = question;

    // Reset UI
    $('p-answer-area').hidden = true;
    $('p-buzzer-result').hidden = true;
    $('p-status').hidden = true;
    $('p-buzzer-btn').disabled = false;
    $('p-buzzer-btn').classList.remove('buzzed-btn');
    $('p-buzzer-area').hidden = false;

    updateSectionIndicator();
    updatePlayerScores();
    showScreen('game');
});

// ===== Buzzer =====
$('p-buzzer-btn').addEventListener('click', () => {
    if (!pState.canBuzz) return;
    pState.canBuzz = false;
    playBuzzSound();
    socket.emit('buzz');
    $('p-buzzer-btn').disabled = true;
    $('p-buzzer-btn').classList.add('buzzed-btn');
});

// ===== Player Buzzed =====
socket.on('player-buzzed', ({ playerName, team, teamName, currentSection }) => {
    pState.canBuzz = false;
    $('p-buzzer-btn').disabled = true;
    $('p-buzzer-area').hidden = true;

    const resultEl = $('p-buzzer-result');
    resultEl.hidden = false;

    if ((currentSection || pState.currentSection) === 1) {
        resultEl.className = 'buzzer-result general-buzzed';
        $('p-buzzer-result-text').textContent = `🔔 ${playerName} ضغط البازر!`;
    } else {
        resultEl.className = `buzzer-result team${team}-buzzed`;
        $('p-buzzer-result-text').textContent = `🔔 ${playerName} (${teamName}) ضغط البازر!`;
    }
});

// ===== Answer Revealed =====
socket.on('answer-revealed', ({ answer }) => {
    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
});

// ===== Correct Answer =====
socket.on('answer-correct', (data) => {
    if (data.playerScores) pState.playerScores = data.playerScores;
    if (data.team1Score !== undefined) pState.team1Score = data.team1Score;
    if (data.team2Score !== undefined) pState.team2Score = data.team2Score;
    const section = data.currentSection || pState.currentSection;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = data.answer;
    $('p-status').hidden = false;

    if (section === 1) {
        $('p-status-text').textContent = `\u2705 إجابة صحيحة! نقطة لـ ${data.playerName}`;
    } else {
        $('p-status-text').textContent = `\u2705 إجابة صحيحة! نقطة لـ ${data.teamName}`;
    }
    $('p-status').className = 'player-status correct-status';

    if (data.isGameOver) return;

    setTimeout(() => {
        if (section === 1) {
            if (data.choosingPlayerId === socket.id) {
                showPlayerLetterGrid();
                showScreen('letterChoice');
            } else {
                $('wait-letter-title').textContent = `${data.playerName} يختار الحرف التالي...`;
                showScreen('waitLetter');
            }
        } else {
            if (data.choosingTeam === pState.myTeam) {
                showPlayerLetterGrid();
                showScreen('letterChoice');
            } else {
                $('wait-letter-title').textContent = `${data.teamName} يختار الحرف التالي...`;
                showScreen('waitLetter');
            }
        }
    }, 2000);
});

// ===== Second Chance =====
socket.on('second-chance', (data) => {
    $('p-buzzer-result').hidden = true;
    const section = data.currentSection || pState.currentSection;

    if (section === 1) {
        if (!data.excludedPlayers.includes(socket.id)) {
            pState.canBuzz = true;
            $('p-buzzer-btn').disabled = false;
            $('p-buzzer-btn').classList.remove('buzzed-btn');
            $('p-buzzer-area').hidden = false;
            $('p-status').hidden = false;
            $('p-status-text').textContent = '\u274C إجابة خاطئة! فرصتك للإجابة';
            $('p-status').className = 'player-status info-status';
        } else {
            $('p-status').hidden = false;
            $('p-status-text').textContent = '\u274C إجابة خاطئة. انتظر...';
            $('p-status').className = 'player-status wrong-status';
            $('p-buzzer-area').hidden = true;
        }
    } else {
        if (pState.myTeam === data.team) {
            pState.canBuzz = true;
            $('p-buzzer-btn').disabled = false;
            $('p-buzzer-btn').classList.remove('buzzed-btn');
            $('p-buzzer-area').hidden = false;
            $('p-status').hidden = false;
            $('p-status-text').textContent = `\u274C الفريق الآخر أخطأ! فرصتك للإجابة`;
            $('p-status').className = 'player-status info-status';
        } else {
            $('p-status').hidden = false;
            $('p-status-text').textContent = `\u274C إجابة خاطئة. الفرصة لـ ${data.teamName}`;
            $('p-status').className = 'player-status wrong-status';
            $('p-buzzer-area').hidden = true;
        }
    }
});

// ===== Both Wrong =====
socket.on('both-wrong', (data) => {
    if (data.team1Score !== undefined) pState.team1Score = data.team1Score;
    if (data.team2Score !== undefined) pState.team2Score = data.team2Score;
    if (data.playerScores) pState.playerScores = data.playerScores;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = data.answer;
    $('p-status').hidden = false;

    const section = data.currentSection || pState.currentSection;
    if (section === 1) {
        $('p-status-text').textContent = '❌ جميع المتسابقين أخطأوا';
    } else {
        $('p-status-text').textContent = '❌ كلا الفريقين أخطأ';
    }
    $('p-status').className = 'player-status wrong-status';
    $('p-buzzer-area').hidden = true;

    if (data.isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
    }, 2000);
});

// ===== Question Skipped =====
socket.on('question-skipped', (data) => {
    if (data.team1Score !== undefined) pState.team1Score = data.team1Score;
    if (data.team2Score !== undefined) pState.team2Score = data.team2Score;
    if (data.playerScores) pState.playerScores = data.playerScores;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = data.answer;
    $('p-status').hidden = false;
    $('p-status-text').textContent = '⏭ تم تخطي السؤال';
    $('p-status').className = 'player-status info-status';
    $('p-buzzer-area').hidden = true;

    if (data.isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
    }, 2000);
});

// ===== Section Switched =====
socket.on('section-switched', ({ currentSection, team1Name, team2Name, maxQuestions }) => {
    pState.currentSection = 2;
    pState.team1Score = 0;
    pState.team2Score = 0;
    pState.usedLetters = [];
    pState.team1Name = team1Name;
    pState.team2Name = team2Name;

    $('p-transition-team1').textContent = team1Name;
    $('p-transition-team2').textContent = team2Name;

    showScreen('transition');
});

// ===== Section 2 Started =====
socket.on('section2-started', ({ team1Name, team2Name, maxQuestions }) => {
    pState.currentSection = 2;
    updateSectionIndicator();
    updatePlayerScores();

    $('wait-letter-title').textContent = 'المسؤول يختار الحرف الأول...';
    showScreen('waitLetter');
});

// ===== Play Sound (from host) =====
socket.on('play-sound', ({ sound }) => {
    if (sound === 'win') {
        playWinnerSound();
    } else if (sound === 'lose') {
        playLoseSound();
    } else if (sound === 'applause') {
        playApplauseSound();
    }
});

// ===== Letter Chosen =====
socket.on('letter-chosen', ({ letter, chosenBy, team }) => {
    // Will receive question-shown next, just wait
});

// ===== Player Letter Grid =====
function showPlayerLetterGrid() {
    const grid = $('p-letters-grid');
    grid.innerHTML = '';
    ARABIC_LETTERS.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = letter;
        if (pState.usedLetters.includes(letter)) {
            btn.classList.add('used');
            btn.setAttribute('aria-disabled', 'true');
        }
        btn.addEventListener('click', () => {
            if (pState.usedLetters.includes(letter)) return;
            socket.emit('choose-letter', { letter });
            $('wait-letter-title').textContent = 'جاري تحميل السؤال...';
            showScreen('waitLetter');
        });
        grid.appendChild(btn);
    });

    updatePlayerScores();
}

// ===== Game Ended =====
socket.on('game-ended', ({ currentSection, team1Name, team2Name, team1Score, team2Score, playerScores }) => {
    const section = currentSection || pState.currentSection;

    if (section === 1 && playerScores) {
        // Section 1 ended - show individual rankings
        $('p-team-results-area').hidden = true;
        const rankArea = $('p-ranking-list-area');
        rankArea.hidden = false;

        const sorted = Object.values(playerScores).sort((a, b) => b.score - a.score);
        const medals = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49'];
        rankArea.innerHTML = sorted.map((p, i) =>
            `<div class="ranking-item ${i === 0 ? 'ranking-first' : ''}">
                <span class="ranking-position">${medals[i] || (i + 1)}</span>
                <span class="ranking-name">${p.name}</span>
                <span class="ranking-score">${p.score} نقاط</span>
            </div>`
        ).join('');

        $('p-results-title').textContent = 'انتهت المسابقة';
        $('p-results-subtitle').textContent = 'القسم الأول: المسابقة العامة';
        $('p-results-icon').textContent = '\ud83c\udfc6';
    } else {
        // Section 2 ended - show team results with applause
        $('p-team-results-area').hidden = false;
        $('p-ranking-list-area').hidden = true;

        $('p-result-team1-name').textContent = team1Name;
        $('p-result-team2-name').textContent = team2Name;
        $('p-result-team1-score').textContent = team1Score;
        $('p-result-team2-score').textContent = team2Score;

        $('p-result-team1').classList.remove('winner');
        $('p-result-team2').classList.remove('winner');

        let title, subtitle, icon;
        if (team1Score > team2Score) {
            title = `\ud83c\udf89 فاز ${team1Name}!`;
            subtitle = `بنتيجة ${team1Score} مقابل ${team2Score}`;
            icon = '\ud83c\udfc6';
            $('p-result-team1').classList.add('winner');
        } else if (team2Score > team1Score) {
            title = `\ud83c\udf89 فاز ${team2Name}!`;
            subtitle = `بنتيجة ${team2Score} مقابل ${team1Score}`;
            icon = '\ud83c\udfc6';
            $('p-result-team2').classList.add('winner');
        } else {
            title = '\ud83e\udd1d تعادل!';
            subtitle = `النتيجة ${team1Score} - ${team2Score}`;
            icon = '\ud83e\udd1d';
        }

        $('p-results-title').textContent = title;
        $('p-results-subtitle').textContent = subtitle;
        $('p-results-icon').textContent = icon;

        // Auto applause for section 2 winner
        playApplauseSound();
        playWinnerSound();
    }

    showScreen('results');
});

// ===== Game Reset =====
socket.on('game-reset', () => {
    pState.currentSection = 1;
    pState.team1Score = 0;
    pState.team2Score = 0;
    pState.playerScores = {};
    pState.usedLetters = [];
    showScreen('waiting');
});

// ===== Host Disconnected =====
socket.on('host-disconnected', () => {
    alert('المسؤول غادر الغرفة. ستتم إعادتك لصفحة الانضمام.');
    showScreen('join');
});
