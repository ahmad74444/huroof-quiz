/* ===== مسابقة حروف - Host Logic ===== */

// ===== Question Registry =====
const allQuestions = {};
const usedQuestionIndices = {}; // track used questions per letter

function registerLetterQuestions(letter, questions) {
    allQuestions[letter] = questions;
}

// ===== Arabic Letters =====
const ARABIC_LETTERS = [
    'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ',
    'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص',
    'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق',
    'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'
];

// ===== Socket Connection =====
let socket;
try {
    socket = io();
    socket.on('connect', () => {
        console.log('متصل بالسيرفر:', socket.id);
    });
    socket.on('connect_error', () => {
        alert('تعذر الاتصال بالسيرفر!\n\nتأكد من تشغيل السيرفر بالأمر:\nnpm start\n\nثم افتح الصفحة من:\nhttp://localhost:3000');
    });
} catch (e) {
    alert('تعذر الاتصال بالسيرفر!\n\nتأكد من تشغيل السيرفر بالأمر:\nnpm start\n\nثم افتح الصفحة من:\nhttp://localhost:3000');
}

// ===== Game State =====
const state = {
    roomCode: '',
    team1: { name: '', score: 0 },
    team2: { name: '', score: 0 },
    players: [],
    currentLetter: '',
    currentQuestion: null,
    questionCount: 0,
    maxQuestions: 10,
    buzzedTeam: null,
    secondChance: false,
    usedLetters: new Set(),
    choosingTeam: null, // which team picks the next letter
    gameActive: false
};

// ===== DOM References =====
const $ = (id) => document.getElementById(id);
const screens = {
    setup: $('setup-screen'),
    lobby: $('lobby-screen'),
    letter: $('letter-screen'),
    game: $('game-screen'),
    results: $('results-screen')
};

// ===== Screen Navigation =====
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    const heading = screens[name].querySelector('h1, h2');
    if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
    }
}

// ===== Announcer =====
function announce(message) {
    const el = $('sr-announcer');
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 100);
}

// ===== Sound Effects =====
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playTone(freq, duration, type = 'square', volume = 0.15) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = type;
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {}
}

function playBuzzerSound() {
    playTone(220, 0.15, 'sawtooth', 0.2);
    setTimeout(() => playTone(330, 0.15, 'sawtooth', 0.2), 80);
}

function playCorrectSound() {
    playTone(523, 0.12, 'sine', 0.2);
    setTimeout(() => playTone(659, 0.12, 'sine', 0.2), 120);
    setTimeout(() => playTone(784, 0.2, 'sine', 0.2), 240);
}

function playWrongSound() {
    playTone(330, 0.2, 'sawtooth', 0.15);
    setTimeout(() => playTone(262, 0.3, 'sawtooth', 0.15), 200);
}

function playWinnerSound() {
    [523, 587, 659, 784, 880, 1047].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.2, 'sine', 0.15), i * 120);
    });
}

// ===== Load Letter Questions =====
function loadLetterQuestions(letter) {
    return new Promise((resolve, reject) => {
        if (allQuestions[letter]) {
            resolve(allQuestions[letter]);
            return;
        }
        const script = document.createElement('script');
        script.src = encodeURI(`مسابقة حروف/${letter}.js`);
        script.onload = () => {
            if (allQuestions[letter]) resolve(allQuestions[letter]);
            else reject(new Error(`لم يتم العثور على أسئلة الحرف: ${letter}`));
        };
        script.onerror = () => reject(new Error(`فشل تحميل ملف الأسئلة للحرف: ${letter}`));
        document.head.appendChild(script);
    });
}

// ===== Get Random Unused Question for Letter =====
function getRandomQuestion(letter) {
    const questions = allQuestions[letter];
    if (!questions) return null;

    if (!usedQuestionIndices[letter]) usedQuestionIndices[letter] = new Set();

    const available = [];
    for (let i = 0; i < questions.length; i++) {
        if (!usedQuestionIndices[letter].has(i)) available.push(i);
    }

    if (available.length === 0) {
        // All used, reset
        usedQuestionIndices[letter].clear();
        for (let i = 0; i < questions.length; i++) available.push(i);
    }

    const idx = available[Math.floor(Math.random() * available.length)];
    usedQuestionIndices[letter].add(idx);
    return questions[idx];
}

// ===== Create Room =====
$('create-room-btn').addEventListener('click', () => {
    const name1 = $('team1-name').value.trim();
    const name2 = $('team2-name').value.trim();

    if (!name1 || !name2) {
        alert('يرجى إدخال أسماء الفريقين');
        if (!name1) $('team1-name').focus();
        else $('team2-name').focus();
        return;
    }

    state.team1.name = name1;
    state.team2.name = name2;
    state.maxQuestions = parseInt($('max-questions').value);

    socket.emit('create-room', {
        team1Name: name1,
        team2Name: name2,
        maxQuestions: state.maxQuestions
    });
});

socket.on('room-created', async ({ code }) => {
    state.roomCode = code;
    $('room-code-display').textContent = code;
    updateTeamNames();

    // Show share link
    let shareLink;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        try {
            const res = await fetch('/api/server-info');
            const info = await res.json();
            shareLink = `http://${info.ip}:${info.port}/player.html?room=${code}`;
        } catch (e) {
            shareLink = `${window.location.origin}/player.html?room=${code}`;
        }
    } else {
        shareLink = `${window.location.origin}/player.html?room=${code}`;
    }
    $('network-link-display').textContent = shareLink;
    $('network-link-display').href = shareLink;
    $('network-link-area').hidden = false;

    showScreen('lobby');
    announce(`تم إنشاء الغرفة. الرمز: ${code}`);
});

// ===== Copy Room Code =====
$('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomCode).then(() => {
        $('copy-code-btn').textContent = '✅ تم النسخ!';
        setTimeout(() => { $('copy-code-btn').textContent = '📋 نسخ الرمز'; }, 2000);
    });
});

$('copy-link-btn').addEventListener('click', async () => {
    let link;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        try {
            const res = await fetch('/api/server-info');
            const info = await res.json();
            link = `http://${info.ip}:${info.port}/player.html?room=${state.roomCode}`;
        } catch (e) {
            link = `${window.location.origin}/player.html?room=${state.roomCode}`;
        }
    } else {
        link = `${window.location.origin}/player.html?room=${state.roomCode}`;
    }
    try {
        await navigator.clipboard.writeText(link);
        $('copy-link-btn').textContent = '✅ تم النسخ!';
    } catch (e) {
        prompt('انسخ الرابط:', link);
    }
    setTimeout(() => { $('copy-link-btn').textContent = '🔗 نسخ رابط الانضمام'; }, 2000);
});

// ===== Player Joined =====
socket.on('player-joined', ({ playerName, team, players }) => {
    state.players = players;
    renderPlayersList();
    announce(`${playerName} انضم إلى الفريق ${team === 1 ? state.team1.name : state.team2.name}`);
});

socket.on('player-left', ({ playerName, players }) => {
    state.players = players;
    renderPlayersList();
});

function renderPlayersList() {
    const list = $('players-list');
    if (state.players.length === 0) {
        list.innerHTML = '<p class="no-players">في انتظار انضمام المتسابقين...</p>';
        return;
    }

    const team1Players = state.players.filter(p => p.team === 1);
    const team2Players = state.players.filter(p => p.team === 2);

    list.innerHTML = `
        <div class="player-group">
            <h4 style="color: var(--team1-light);">${state.team1.name} (${team1Players.length})</h4>
            ${team1Players.map(p => `<span class="player-tag team1-tag">${p.name}</span>`).join('')}
            ${team1Players.length === 0 ? '<span class="no-players-sm">لا يوجد لاعبين</span>' : ''}
        </div>
        <div class="player-group">
            <h4 style="color: var(--team2-light);">${state.team2.name} (${team2Players.length})</h4>
            ${team2Players.map(p => `<span class="player-tag team2-tag">${p.name}</span>`).join('')}
            ${team2Players.length === 0 ? '<span class="no-players-sm">لا يوجد لاعبين</span>' : ''}
        </div>
    `;
}

// ===== Start Game =====
$('start-game-btn').addEventListener('click', () => {
    socket.emit('start-game');
    state.gameActive = true;
    state.questionCount = 0;
    state.team1.score = 0;
    state.team2.score = 0;
    state.usedLetters.clear();
    state.choosingTeam = null;

    updateAllScoreDisplays();
    updateTeamNames();
    generateLetterGrid();

    $('letter-screen-title').textContent = 'اختر حرفاً للسؤال الأول';
    $('letter-screen-subtitle').textContent = 'المسؤول يختار الحرف الأول';
    $('question-progress').textContent = `السؤال 1 من ${state.maxQuestions}`;

    showScreen('letter');
    announce('بدأت المسابقة! اختر حرفاً للسؤال الأول.');
});

// ===== Update Team Names =====
function updateTeamNames() {
    const n1 = state.team1.name;
    const n2 = state.team2.name;
    $('score-team1-name').textContent = n1;
    $('score-team2-name').textContent = n2;
    $('game-team1-name').textContent = n1;
    $('game-team2-name').textContent = n2;
    $('result-team1-name').textContent = n1;
    $('result-team2-name').textContent = n2;
}

// ===== Update Scores =====
function updateAllScoreDisplays() {
    const s1 = state.team1.score;
    const s2 = state.team2.score;
    $('score-team1-value').textContent = s1;
    $('score-team2-value').textContent = s2;
    $('game-team1-score').textContent = s1;
    $('game-team2-score').textContent = s2;
}

function animateScore(elementId) {
    const el = $(elementId);
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
}

// ===== Letter Grid =====
function generateLetterGrid() {
    const grid = $('letters-grid');
    grid.innerHTML = '';
    ARABIC_LETTERS.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = letter;
        btn.setAttribute('aria-label', `حرف ${letter}`);
        if (state.usedLetters.has(letter)) {
            btn.classList.add('used');
            btn.setAttribute('aria-disabled', 'true');
        }
        btn.addEventListener('click', () => selectLetter(letter));
        grid.appendChild(btn);
    });
}

// ===== Select Letter =====
async function selectLetter(letter) {
    if (state.usedLetters.has(letter)) return;

    try {
        await loadLetterQuestions(letter);
        const q = getRandomQuestion(letter);
        if (!q) {
            alert('لا توجد أسئلة متاحة لهذا الحرف');
            return;
        }

        state.currentLetter = letter;
        state.currentQuestion = q;
        state.usedLetters.add(letter);
        state.buzzedTeam = null;
        state.secondChance = false;

        // Send to server
        socket.emit('send-question', {
            letter,
            question: q.q,
            answer: q.a
        });

        // Show question on host screen
        state.questionCount++;
        $('current-letter-display').textContent = letter;
        $('question-counter').textContent = `السؤال ${state.questionCount} من ${state.maxQuestions}`;
        $('question-text').textContent = q.q;
        $('answer-text').textContent = q.a;

        // Reset UI
        $('answer-area').hidden = true;
        $('buzzer-result').hidden = true;
        $('buzzer-result').className = 'buzzer-result';
        $('host-controls').hidden = true;
        $('waiting-buzz').hidden = false;

        showScreen('game');
        announce(`حرف ${letter}. السؤال ${state.questionCount}: ${q.q}`);
    } catch (err) {
        alert(err.message);
    }
}

// ===== Handle Player Buzz =====
socket.on('player-buzzed', ({ playerName, team, teamName }) => {
    state.buzzedTeam = team;
    playBuzzerSound();

    $('waiting-buzz').hidden = true;

    const resultEl = $('buzzer-result');
    resultEl.hidden = false;
    resultEl.className = `buzzer-result team${team}-buzzed`;
    $('buzzer-result-text').textContent = `🔔 ${playerName} (${teamName}) ضغط البازر!`;

    $('host-controls').hidden = false;
    $('btn-show-answer').focus();

    announce(`${playerName} من ${teamName} ضغط البازر`);
});

// ===== Host Controls =====
$('btn-show-answer').addEventListener('click', () => {
    $('answer-area').hidden = false;
    socket.emit('show-answer');
    announce(`الجواب: ${state.currentQuestion.a}`);
});

$('btn-correct').addEventListener('click', () => {
    if (!state.buzzedTeam) return;

    const team = state.buzzedTeam === 1 ? state.team1 : state.team2;
    team.score++;
    updateAllScoreDisplays();
    playCorrectSound();

    if (state.buzzedTeam === 1) {
        animateScore('game-team1-score');
        animateScore('score-team1-value');
    } else {
        animateScore('game-team2-score');
        animateScore('score-team2-value');
    }

    socket.emit('judge-correct');

    $('host-controls').hidden = true;
    $('answer-area').hidden = false;
    announce(`إجابة صحيحة! نقطة لـ ${team.name}`);

    // Check if game over
    if (state.questionCount >= state.maxQuestions) {
        setTimeout(() => endGame(), 2000);
    } else {
        // Go to letter selection - winning team chooses
        state.choosingTeam = state.buzzedTeam;
        setTimeout(() => showLetterSelection(), 2000);
    }
});

$('btn-wrong').addEventListener('click', () => {
    if (!state.buzzedTeam) return;
    playWrongSound();

    if (!state.secondChance) {
        state.secondChance = true;
        socket.emit('judge-wrong');

        const wrongTeamName = state.buzzedTeam === 1 ? state.team1.name : state.team2.name;
        const otherTeam = state.buzzedTeam === 1 ? 2 : 1;
        const otherName = otherTeam === 1 ? state.team1.name : state.team2.name;

        state.buzzedTeam = null;
        $('host-controls').hidden = true;
        $('buzzer-result').hidden = true;
        $('waiting-buzz').hidden = false;
        $('waiting-buzz').querySelector('.waiting-text').textContent =
            `❌ ${wrongTeamName} أخطأ! الفرصة لـ ${otherName}...`;

        announce(`إجابة خاطئة من ${wrongTeamName}. الفرصة لـ ${otherName}`);
    } else {
        socket.emit('judge-wrong');

        $('host-controls').hidden = true;
        $('answer-area').hidden = false;
        announce(`إجابة خاطئة. الجواب: ${state.currentQuestion.a}`);

        if (state.questionCount >= state.maxQuestions) {
            setTimeout(() => endGame(), 2000);
        } else {
            state.choosingTeam = null; // host picks
            setTimeout(() => showLetterSelection(), 2000);
        }
    }
});

$('btn-skip').addEventListener('click', () => {
    socket.emit('skip-question');

    $('host-controls').hidden = true;
    $('waiting-buzz').hidden = true;
    $('answer-area').hidden = false;
    announce(`تم تخطي السؤال. الجواب: ${state.currentQuestion.a}`);

    if (state.questionCount >= state.maxQuestions) {
        setTimeout(() => endGame(), 2000);
    } else {
        state.choosingTeam = null;
        setTimeout(() => showLetterSelection(), 2000);
    }
});

// ===== Show Letter Selection =====
function showLetterSelection() {
    generateLetterGrid();

    const nextNum = state.questionCount + 1;
    $('question-progress').textContent = `السؤال ${nextNum} من ${state.maxQuestions}`;

    if (state.choosingTeam) {
        const teamName = state.choosingTeam === 1 ? state.team1.name : state.team2.name;
        $('letter-screen-title').textContent = `${teamName} يختار الحرف`;
        $('letter-screen-subtitle').textContent = 'الفريق الفائز بالسؤال السابق يختار الحرف التالي';
    } else {
        $('letter-screen-title').textContent = 'اختر حرفاً';
        $('letter-screen-subtitle').textContent = 'اختر حرفاً للسؤال التالي';
    }

    updateAllScoreDisplays();
    showScreen('letter');
}

// ===== Player Chose Letter (from their device) =====
socket.on('load-letter-question', async ({ letter }) => {
    // A player from the winning team chose a letter - load and send question
    if (state.usedLetters.has(letter)) return; // already used
    await selectLetter(letter);
});

// ===== End Game =====
$('end-game-early-btn').addEventListener('click', () => {
    if (confirm('هل تريد إنهاء المسابقة؟')) {
        endGame();
    }
});

function endGame() {
    state.gameActive = false;
    playWinnerSound();
    socket.emit('end-game');

    const s1 = state.team1.score;
    const s2 = state.team2.score;

    $('result-team1-score').textContent = s1;
    $('result-team2-score').textContent = s2;
    $('result-team1').classList.remove('winner');
    $('result-team2').classList.remove('winner');

    let title, subtitle, icon;
    if (s1 > s2) {
        title = `🎉 فاز ${state.team1.name}!`;
        subtitle = `بنتيجة ${s1} مقابل ${s2}`;
        icon = '🏆';
        $('result-team1').classList.add('winner');
    } else if (s2 > s1) {
        title = `🎉 فاز ${state.team2.name}!`;
        subtitle = `بنتيجة ${s2} مقابل ${s1}`;
        icon = '🏆';
        $('result-team2').classList.add('winner');
    } else {
        title = '🤝 تعادل!';
        subtitle = `النتيجة ${s1} - ${s2}`;
        icon = '🤝';
    }

    $('results-title').textContent = title;
    $('results-subtitle').textContent = subtitle;
    $('results-icon').textContent = icon;

    showScreen('results');
    announce(title + '. ' + subtitle);
}

// ===== New Game =====
$('btn-new-game').addEventListener('click', () => {
    state.team1.score = 0;
    state.team2.score = 0;
    state.usedLetters.clear();
    state.questionCount = 0;
    state.choosingTeam = null;
    Object.keys(usedQuestionIndices).forEach(k => delete usedQuestionIndices[k]);

    socket.emit('new-game');
    renderPlayersList();
    showScreen('lobby');
    announce('مسابقة جديدة. في انتظار البدء.');
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    $('team1-name').focus();
});
