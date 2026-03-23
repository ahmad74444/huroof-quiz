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
    alert('تعذر الاتصال بالسيرفر!');
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

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const screens = {
    join: $('join-screen'),
    waiting: $('waiting-screen'),
    game: $('player-game-screen'),
    waitLetter: $('player-wait-letter-screen'),
    transition: $('player-transition-screen'),
    results: $('player-results-screen')
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// ===== Screen Reader Announcer =====
function announce(message) {
    const el = $('sr-announcer');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 100);
}

// ===== Sound Effects (real audio files) =====
const sounds = {
    correct: new Audio(encodeURI('إجابة صحيحة - مؤثر صوتي.wav')),
    wrong: new Audio(encodeURI('إجابة خاطئة - مؤثر صوتي.wav')),
    win: new Audio(encodeURI('الفوز - مؤثر صوتي.mp3')),
    buzzer: new Audio(encodeURI('صوت البوزر - مؤثر صوتي.wav'))
};

Object.values(sounds).forEach(s => { s.load(); });

function playSound(name) {
    const s = sounds[name];
    if (s) {
        s.currentTime = 0;
        s.play().catch(() => {});
    }
}

// ===== Mic Audio Playback (Real-time via MediaSource) =====
let mediaSource = null;
let sourceBuffer = null;
let micAudioEl = null;
let micPendingChunks = [];
let micSourceOpen = false;

function initMicStream() {
    // Clean up previous
    cleanupMicStream();

    mediaSource = new MediaSource();
    micAudioEl = new Audio();
    micAudioEl.src = URL.createObjectURL(mediaSource);
    micPendingChunks = [];
    micSourceOpen = false;

    mediaSource.addEventListener('sourceopen', () => {
        try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/webm;codecs=opus');
            micSourceOpen = true;
            sourceBuffer.addEventListener('updateend', flushMicChunks);
            flushMicChunks();
        } catch (e) {
            console.warn('MediaSource not supported, falling back to buffered mode');
            micSourceOpen = false;
        }
    });

    micAudioEl.play().catch(() => {});
}

function flushMicChunks() {
    if (!sourceBuffer || sourceBuffer.updating || micPendingChunks.length === 0) return;
    const chunk = micPendingChunks.shift();
    try {
        sourceBuffer.appendBuffer(chunk);
    } catch (e) {
        // Buffer full or error - skip chunk
    }
}

function cleanupMicStream() {
    if (micAudioEl) {
        micAudioEl.pause();
        if (micAudioEl.src) URL.revokeObjectURL(micAudioEl.src);
        micAudioEl = null;
    }
    if (mediaSource && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch (e) {}
    }
    mediaSource = null;
    sourceBuffer = null;
    micPendingChunks = [];
    micSourceOpen = false;
}

// Fallback: buffered playback if MediaSource doesn't work
let micFallbackChunks = [];
let micUsingFallback = false;

socket.on('mic-started', () => {
    $('mic-indicator').hidden = false;
    announce('المسؤول يتحدث');

    // Check MediaSource support
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm;codecs=opus')) {
        micUsingFallback = false;
        initMicStream();
    } else {
        micUsingFallback = true;
        micFallbackChunks = [];
    }
});

socket.on('mic-stopped', () => {
    $('mic-indicator').hidden = true;

    if (micUsingFallback) {
        // Fallback: play all at once
        if (micFallbackChunks.length > 0) {
            const blob = new Blob(micFallbackChunks, { type: 'audio/webm;codecs=opus' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play().catch(() => {});
            audio.onended = () => URL.revokeObjectURL(url);
            micFallbackChunks = [];
        }
    } else {
        // End the media source stream
        if (mediaSource && mediaSource.readyState === 'open') {
            // Wait for buffer to finish then end stream
            const tryEnd = () => {
                if (sourceBuffer && sourceBuffer.updating) {
                    setTimeout(tryEnd, 100);
                } else {
                    try { mediaSource.endOfStream(); } catch (e) {}
                }
            };
            tryEnd();
        }
    }
});

socket.on('mic-audio', (data) => {
    const chunk = new Uint8Array(data);

    if (micUsingFallback) {
        micFallbackChunks.push(chunk);
    } else {
        micPendingChunks.push(chunk);
        flushMicChunks();
    }
});

// ===== Auto-fill room code from URL =====
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
        $('room-code-input').value = roomCode;
        setTimeout(() => checkRoomInfo(roomCode), 500);
    }
    $('room-code-input').focus();
});

// ===== Check Room Info (show/hide team selection) =====
let checkRoomTimeout = null;
$('room-code-input').addEventListener('input', () => {
    clearTimeout(checkRoomTimeout);
    const code = $('room-code-input').value.trim();
    if (code.length >= 5) {
        checkRoomTimeout = setTimeout(() => checkRoomInfo(code), 300);
    }
});

function checkRoomInfo(code) {
    socket.emit('check-room', { code });
}

socket.on('room-info', ({ exists, enableSection2, team1Name, team2Name }) => {
    if (exists) {
        if (enableSection2) {
            $('team-select-field').style.display = '';
            if (team1Name) $('team1-option').textContent = team1Name;
            if (team2Name) $('team2-option').textContent = team2Name;
        } else {
            $('team-select-field').style.display = 'none';
        }
    }
});

// ===== Join Room =====
$('join-btn').addEventListener('click', () => {
    const code = $('room-code-input').value.trim();
    const name = $('player-name-input').value.trim();
    const teamSelect = $('team-select-dropdown');
    const team = parseInt(teamSelect.value) || 0;

    if (!code) { showJoinError('أدخل رمز الغرفة'); return; }
    if (!name) { showJoinError('أدخل اسمك'); return; }

    // Only require team if team-select is visible
    const teamFieldVisible = $('team-select-field').style.display !== 'none';
    if (teamFieldVisible && !team) { showJoinError('اختر فريقك'); return; }

    $('join-error').hidden = true;
    socket.emit('join-room', { code, playerName: name, team: team || 1 });
});

function showJoinError(msg) {
    $('join-error').textContent = msg;
    $('join-error').hidden = false;
    announce(msg);
}

socket.on('join-error', (msg) => {
    showJoinError(msg);
});

socket.on('joined-room', ({ team1Name, team2Name, team, gameStarted, currentSection, enableSection1, enableSection2 }) => {
    pState.myTeam = team;
    pState.currentSection = currentSection || 1;
    pState.team1Name = team1Name;
    pState.team2Name = team2Name;

    if (enableSection2 && team1Name && team2Name) {
        $('my-team-info').textContent = `أنت في فريق: ${team === 1 ? team1Name : team2Name}`;
    } else {
        $('my-team-info').textContent = 'مرحباً بك في المسابقة!';
    }

    $('p-result-team1-name').textContent = team1Name;
    $('p-result-team2-name').textContent = team2Name;

    if (gameStarted) {
        showScreen('game');
    } else {
        showScreen('waiting');
    }

    announce('تم الانضمام للمسابقة. في انتظار بدء المسابقة.');
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
        const sorted = Object.values(pState.playerScores)
            .sort((a, b) => b.score - a.score);

        const scoreboardEl = $('p-scoreboard');
        if (scoreboardEl) {
            scoreboardEl.innerHTML = sorted.slice(0, 3).map((p, i) =>
                `<div class="score-item"><span class="score-team-name" style="color: var(--gold-light);">${['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] || ''} ${p.name}</span><span class="score-value" style="color: var(--gold);">${p.score}</span></div>`
            ).join('<div class="score-divider" aria-hidden="true">|</div>') || '';
        }
    } else {
        const scoreboardEl = $('p-scoreboard');
        if (scoreboardEl) {
            scoreboardEl.innerHTML = `
                <div class="score-item team1-score">
                    <span class="score-team-name">${pState.team1Name}</span>
                    <span class="score-value">${pState.team1Score}</span>
                </div>
                <div class="score-divider">:</div>
                <div class="score-item team2-score">
                    <span class="score-value">${pState.team2Score}</span>
                    <span class="score-team-name">${pState.team2Name}</span>
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
    announce('بدأت المسابقة! انتظر حتى يختار المسؤول الحرف.');
});

// ===== Player Countdown Timer =====
let pTimerInterval = null;
let pTimeLeft = 0;

function startPlayerCountdown(seconds) {
    stopPlayerCountdown();
    if (!seconds || seconds <= 0) {
        $('p-countdown-display').hidden = true;
        return;
    }
    pTimeLeft = seconds;
    $('p-countdown-display').hidden = false;
    $('p-countdown-number').textContent = pTimeLeft;
    $('p-countdown-number').classList.remove('countdown-urgent');

    pTimerInterval = setInterval(() => {
        pTimeLeft--;
        $('p-countdown-number').textContent = Math.max(0, pTimeLeft);
        if (pTimeLeft <= 5) $('p-countdown-number').classList.add('countdown-urgent');
        if (pTimeLeft <= 0) stopPlayerCountdown();
    }, 1000);
}

function stopPlayerCountdown() {
    if (pTimerInterval) { clearInterval(pTimerInterval); pTimerInterval = null; }
    $('p-countdown-display').hidden = true;
    $('p-countdown-number').classList.remove('countdown-urgent');
}

// ===== Question Shown =====
socket.on('question-shown', ({ letter, question, showQuestion, questionNumber, maxQuestions, currentSection, team1Score, team2Score, playerScores, buzzerTimeout }) => {
    pState.currentSection = currentSection || pState.currentSection;
    pState.team1Score = team1Score;
    pState.team2Score = team2Score;
    if (playerScores) pState.playerScores = playerScores;
    pState.canBuzz = true;
    pState.buzzerTimeout = buzzerTimeout || 0;

    if (!pState.usedLetters.includes(letter)) {
        pState.usedLetters.push(letter);
    }

    $('p-current-letter').textContent = letter;
    if (pState.currentSection === 1) {
        $('p-question-counter').textContent = `السؤال ${questionNumber}`;
    } else {
        $('p-question-counter').textContent = `السؤال ${questionNumber} من ${maxQuestions}`;
    }

    if (showQuestion && question) {
        $('p-question-area').hidden = false;
        $('p-question-text').textContent = question;
    } else {
        $('p-question-area').hidden = true;
        $('p-question-text').textContent = '';
    }

    $('p-answer-area').hidden = true;
    $('p-buzzer-result').hidden = true;
    $('p-status').hidden = true;

    const buzzerBtn = $('p-buzzer-btn');
    buzzerBtn.disabled = false;
    buzzerBtn.classList.remove('buzzed-btn');
    buzzerBtn.classList.add('buzzer-ready');
    $('p-buzzer-area').hidden = false;

    startPlayerCountdown(buzzerTimeout);
    updateSectionIndicator();
    updatePlayerScores();
    showScreen('game');

    if (showQuestion && question) {
        announce(`حرف ${letter}. السؤال ${questionNumber}: ${question}. اضغط البازر للإجابة.`);
    } else {
        announce(`حرف ${letter}. السؤال ${questionNumber}. اضغط البازر للإجابة.`);
    }
});

// ===== Buzzer =====
$('p-buzzer-btn').addEventListener('click', () => {
    if (!pState.canBuzz) return;
    pState.canBuzz = false;
    playSound('buzzer');
    socket.emit('buzz');

    const buzzerBtn = $('p-buzzer-btn');
    buzzerBtn.disabled = true;
    buzzerBtn.classList.add('buzzed-btn');
    buzzerBtn.classList.remove('buzzer-ready');
    announce('ضغطت البازر!');
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

    announce(`${playerName} ضغط البازر`);
});

// ===== Answer Revealed =====
socket.on('answer-revealed', ({ answer }) => {
    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = answer;
    announce(`الجواب: ${answer}`);
});

// ===== Play Sound (from host) =====
socket.on('play-sound', ({ sound }) => {
    if (sound === 'correct') playSound('correct');
    else if (sound === 'wrong') playSound('wrong');
    else if (sound === 'win') playSound('win');
    else if (sound === 'lose') playSound('wrong');
    else if (sound === 'applause') playSound('win');
});

// ===== Correct Answer =====
socket.on('answer-correct', (data) => {
    if (data.playerScores) pState.playerScores = data.playerScores;
    if (data.team1Score !== undefined) pState.team1Score = data.team1Score;
    if (data.team2Score !== undefined) pState.team2Score = data.team2Score;
    updatePlayerScores();

    $('p-answer-area').hidden = false;
    $('p-answer-text').textContent = data.answer;
    $('p-status').hidden = false;

    const section = data.currentSection || pState.currentSection;
    if (section === 1) {
        $('p-status-text').textContent = `✅ إجابة صحيحة! نقطة لـ ${data.playerName}`;
    } else {
        $('p-status-text').textContent = `✅ إجابة صحيحة! نقطة لـ ${data.teamName}`;
    }
    $('p-status').className = 'player-status correct-status';

    announce($('p-status-text').textContent);

    if (data.isGameOver) return;

    // All letter choice is done by host now — go to wait screen
    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
        announce('انتظر حتى يختار المسؤول الحرف التالي.');
    }, 2000);
});

// ===== Second Chance =====
socket.on('second-chance', (data) => {
    $('p-buzzer-result').hidden = true;
    const section = data.currentSection || pState.currentSection;

    if (section === 1) {
        if (!data.excludedPlayers.includes(socket.id)) {
            pState.canBuzz = true;
            const buzzerBtn = $('p-buzzer-btn');
            buzzerBtn.disabled = false;
            buzzerBtn.classList.remove('buzzed-btn');
            buzzerBtn.classList.add('buzzer-ready');
            $('p-buzzer-area').hidden = false;
            $('p-status').hidden = false;
            $('p-status-text').textContent = '❌ إجابة خاطئة! فرصتك للإجابة';
            $('p-status').className = 'player-status info-status';
            announce('إجابة خاطئة! فرصتك للإجابة. اضغط البازر.');
        } else {
            $('p-status').hidden = false;
            $('p-status-text').textContent = '❌ إجابة خاطئة. انتظر...';
            $('p-status').className = 'player-status wrong-status';
            $('p-buzzer-area').hidden = true;
            announce('إجابة خاطئة. انتظر.');
        }
    } else {
        if (pState.myTeam === data.team) {
            pState.canBuzz = true;
            const buzzerBtn = $('p-buzzer-btn');
            buzzerBtn.disabled = false;
            buzzerBtn.classList.remove('buzzed-btn');
            buzzerBtn.classList.add('buzzer-ready');
            $('p-buzzer-area').hidden = false;
            $('p-status').hidden = false;
            $('p-status-text').textContent = '❌ الفريق الآخر أخطأ! فرصتك للإجابة';
            $('p-status').className = 'player-status info-status';
            announce('الفريق الآخر أخطأ! فرصتك للإجابة. اضغط البازر.');
        } else {
            $('p-status').hidden = false;
            $('p-status-text').textContent = `❌ إجابة خاطئة. الفرصة لـ ${data.teamName}`;
            $('p-status').className = 'player-status wrong-status';
            $('p-buzzer-area').hidden = true;
            announce(`إجابة خاطئة. الفرصة لـ ${data.teamName}`);
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

    announce($('p-status-text').textContent + '. الجواب: ' + data.answer);

    if (data.isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
        announce('انتظر حتى يختار المسؤول الحرف التالي.');
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

    announce('تم تخطي السؤال. الجواب: ' + data.answer);

    if (data.isGameOver) return;

    setTimeout(() => {
        $('wait-letter-title').textContent = 'المسؤول يختار الحرف التالي...';
        showScreen('waitLetter');
        announce('انتظر حتى يختار المسؤول الحرف التالي.');
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
    announce('انتهى القسم الأول! القسم الثاني: مسابقة الفريقين.');
});

// ===== Section 2 Started =====
socket.on('section2-started', ({ team1Name, team2Name, maxQuestions }) => {
    pState.currentSection = 2;
    updateSectionIndicator();
    updatePlayerScores();

    $('wait-letter-title').textContent = 'المسؤول يختار الحرف الأول...';
    showScreen('waitLetter');
    announce('بدأ القسم الثاني! مسابقة الفريقين. انتظر حتى يختار المسؤول الحرف.');
});

// ===== Letter Chosen =====
socket.on('letter-chosen', ({ letter, chosenBy }) => {
    // Will receive question-shown next
});

// ===== Game Ended =====
socket.on('game-ended', ({ currentSection, team1Name, team2Name, team1Score, team2Score, playerScores }) => {
    const section = currentSection || pState.currentSection;

    if (section === 1 && playerScores) {
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

        announce('انتهت المسابقة! ' + (sorted.length > 0 ? `الفائز: ${sorted[0].name}` : ''));
    } else {
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

        announce(title + ' ' + subtitle);
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
    announce('مسابقة جديدة. في انتظار بدء المسابقة.');
});

// ===== Host Disconnected =====
socket.on('host-disconnected', () => {
    alert('المسؤول غادر الغرفة. ستتم إعادتك لصفحة الانضمام.');
    showScreen('join');
    announce('المسؤول غادر الغرفة.');
});
