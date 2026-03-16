/* ===== مسابقة حروف - Player Logic ===== */

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
    team1Name: '',
    team2Name: '',
    team1Score: 0,
    team2Score: 0,
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

socket.on('joined-room', ({ team1Name, team2Name, team, gameStarted }) => {
    pState.myTeam = team;
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

// ===== Game Started =====
socket.on('game-started', ({ team1Name, team2Name, maxQuestions }) => {
    pState.team1Name = team1Name;
    pState.team2Name = team2Name;
    pState.team1Score = 0;
    pState.team2Score = 0;
    pState.usedLetters = [];
    updatePlayerScores();

    // Wait for first question - show waiting screen
    showScreen('waitLetter');
    $('wait-letter-title').textContent = 'المسؤول يختار الحرف الأول...';
});

// ===== Question Shown =====
socket.on('question-shown', ({ letter, question, questionNumber, maxQuestions, team1Score, team2Score }) => {
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    pState.canBuzz = true;

    if (!pState.usedLetters.includes(letter)) {
        pState.usedLetters.push(letter);
    }

    $('p-current-letter').textContent = letter;
    $('p-question-counter').textContent = `السؤال ${questionNumber} من ${maxQuestions}`;
    $('p-question-text').textContent = question;

    // Reset UI
    $('p-answer-area').hidden = true;
    $('p-buzzer-result').hidden = true;
    $('p-status').hidden = true;
    $('p-buzzer-btn').disabled = false;
    $('p-buzzer-btn').classList.remove('buzzed-btn');
    $('p-buzzer-area').hidden = false;

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
socket.on('player-buzzed', ({ playerName, team, teamName }) => {
    pState.canBuzz = false;
    $('p-buzzer-btn').disabled = true;
    $('p-buzzer-area').hidden = true;

    const resultEl = $('p-buzzer-result');
    resultEl.hidden = false;
    resultEl.className = `buzzer-result team${team}-buzzed`;
    $('p-buzzer-result-text').textContent = `🔔 ${playerName} (${teamName}) ضغط البازر!`;
});

// ===== Answer Revealed =====
socket.on('answer-revealed', ({ answer }) => {
    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
});

// ===== Correct Answer =====
socket.on('answer-correct', ({ team, teamName, answer, team1Score, team2Score, choosingTeam, isGameOver }) => {
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
    $('p-status').hidden = false;
    $('p-status-text').textContent = `✅ إجابة صحيحة! نقطة لـ ${teamName}`;
    $('p-status').className = 'player-status correct-status';

    if (isGameOver) {
        // Wait for game-ended event
        return;
    }

    // After delay, show letter choice or waiting
    setTimeout(() => {
        if (choosingTeam === pState.myTeam) {
            // My team gets to choose!
            showPlayerLetterGrid();
            showScreen('letterChoice');
        } else {
            $('wait-letter-title').textContent = `${teamName} يختار الحرف التالي...`;
            showScreen('waitLetter');
        }
    }, 2000);
});

// ===== Second Chance =====
socket.on('second-chance', ({ wrongTeam, team, teamName }) => {
    $('p-buzzer-result').hidden = true;

    if (pState.myTeam === team) {
        // My team gets second chance
        pState.canBuzz = true;
        $('p-buzzer-btn').disabled = false;
        $('p-buzzer-btn').classList.remove('buzzed-btn');
        $('p-buzzer-area').hidden = false;
        $('p-status').hidden = false;
        $('p-status-text').textContent = `❌ الفريق الآخر أخطأ! فرصتك للإجابة`;
        $('p-status').className = 'player-status info-status';
    } else {
        // My team was wrong
        $('p-status').hidden = false;
        $('p-status-text').textContent = `❌ إجابة خاطئة. الفرصة لـ ${teamName}`;
        $('p-status').className = 'player-status wrong-status';
        $('p-buzzer-area').hidden = true;
    }
});

// ===== Both Wrong =====
socket.on('both-wrong', ({ answer, team1Score, team2Score, isGameOver }) => {
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
    $('p-status').hidden = false;
    $('p-status-text').textContent = '❌ كلا الفريقين أخطأ';
    $('p-status').className = 'player-status wrong-status';
    $('p-buzzer-area').hidden = true;

    if (isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
    }, 2000);
});

// ===== Question Skipped =====
socket.on('question-skipped', ({ answer, team1Score, team2Score, isGameOver }) => {
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
    $('p-status').hidden = false;
    $('p-status-text').textContent = '⏭ تم تخطي السؤال';
    $('p-status').className = 'player-status info-status';
    $('p-buzzer-area').hidden = true;

    if (isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
    }, 2000);
});

// ===== Letter Chosen (by other team or host) =====
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
            // Show waiting after choosing
            $('wait-letter-title').textContent = 'جاري تحميل السؤال...';
            showScreen('waitLetter');
        });
        grid.appendChild(btn);
    });

    $('pl-team1-score').textContent = pState.team1Score;
    $('pl-team2-score').textContent = pState.team2Score;
}

// ===== Game Ended =====
socket.on('game-ended', ({ team1Name, team2Name, team1Score, team2Score }) => {
    $('p-result-team1-name').textContent = team1Name;
    $('p-result-team2-name').textContent = team2Name;
    $('p-result-team1-score').textContent = team1Score;
    $('p-result-team2-score').textContent = team2Score;

    $('p-result-team1').classList.remove('winner');
    $('p-result-team2').classList.remove('winner');

    let title, subtitle, icon;
    if (team1Score > team2Score) {
        title = `🎉 فاز ${team1Name}!`;
        subtitle = `بنتيجة ${team1Score} مقابل ${team2Score}`;
        icon = '🏆';
        $('p-result-team1').classList.add('winner');
    } else if (team2Score > team1Score) {
        title = `🎉 فاز ${team2Name}!`;
        subtitle = `بنتيجة ${team2Score} مقابل ${team1Score}`;
        icon = '🏆';
        $('p-result-team2').classList.add('winner');
    } else {
        title = '🤝 تعادل!';
        subtitle = `النتيجة ${team1Score} - ${team2Score}`;
        icon = '🤝';
    }

    $('p-results-title').textContent = title;
    $('p-results-subtitle').textContent = subtitle;
    $('p-results-icon').textContent = icon;

    showScreen('results');
});

// ===== Game Reset =====
socket.on('game-reset', () => {
    pState.team1Score = 0;
    pState.team2Score = 0;
    pState.usedLetters = [];
    showScreen('waiting');
});

// ===== Host Disconnected =====
socket.on('host-disconnected', () => {
    alert('المسؤول غادر الغرفة. ستتم إعادتك لصفحة الانضمام.');
    showScreen('join');
});

// ===== Helpers =====
function updatePlayerScores() {
    $('p-team1-score').textContent = pState.team1Score;
    $('p-team2-score').textContent = pState.team2Score;
}
