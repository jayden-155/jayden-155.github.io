// --- IndexedDB Database Layer (No Framework) ---
const DB_NAME = 'FitnessTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'appState';

const db = {
    open: () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    save: async (state) => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(state, 'currentState');

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    load: async () => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get('currentState');

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    clear: async () => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
        });
    }
};

// --- Utilities ---
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Security: Sanitize Input for HTML Rendering
function escapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function attachListener(id, event, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
    }
}

// Security: Enforce numeric inputs and prevent catastrophic regex backtracking
window.enforceNumeric = function(input, isDecimal) {
    // Cap raw input before processing to prevent long-string hangs
    let val = String(input.value).substring(0, 20); 
    
    if (isDecimal) {
        val = val.replace(/[^0-9.]/g, '');
        const parts = val.split('.');
        if (parts.length > 2) {
            val = parts[0] + '.' + parts.slice(1).join('');
        }
        if (val.length > 10) val = val.substring(0, 10);
    } else {
        val = val.replace(/[^0-9]/g, '');
        if (val.length > 5) val = val.substring(0, 5); // Max 99999
    }
    input.value = val;
};

// Security: Enforce Rep Range for Templates safely
window.enforceRepRange = function(input) {
    let val = String(input.value).substring(0, 20);
    val = val.replace(/[^0-9-]/g, '');
    const parts = val.split('-');
    if (parts.length > 2) {
        val = parts[0] + '-' + parts.slice(1).join('');
    }
    if (val.length > 15) val = val.substring(0, 15);
    input.value = val;
};

// --- Toast Notifications ---
function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast flex items-center justify-between';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17"></path></svg>
            <span>${escapeHtml(msg)}</span>
        </div>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Modal Scroll Management ---
function setModalOpen(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('active');
        document.body.classList.add('no-scroll');
    }
}

function setModalClose(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active');
    }
    // Only unlock scroll if NO modals are currently active
    if (document.querySelectorAll('.modal.active, .rest-timer-overlay.active').length === 0) {
        document.body.classList.remove('no-scroll');
    }
}

// --- Global State Management ---
let state = {
    exercises: [],
    programs: [],
    standaloneWorkouts: [],
    currentProgram: null,
    currentWeek: 1,
    workoutHistory: [],
    bodyweightHistory: [],
    activeWorkout: null,
    editingProgram: null,
    editingProgramWeek: 0,
    editingWorkout: null,
    workoutBuilderContext: 'program',
    weightUnit: 'lbs',
    editingExerciseId: null
};

// Added for Multi-Select in Builder
let selectedExercisesForBuilder = new Set(); 

// --- PR Calculations ---
function getE1RM(weight, reps) {
    if (!weight || !reps || reps < 1) return 0;
    return Math.round(weight * (1 + reps / 30));
}

function getExerciseMaxes(exerciseId) {
    let maxWeight = 0;
    let max1RM = 0;
    
    if (state.workoutHistory) {
        state.workoutHistory.forEach(w => {
            const ex = w.exercises.find(e => e.exerciseId === exerciseId);
            if (ex) {
                ex.sets.forEach(s => {
                    const wgt = parseFloat(s.weight) || 0;
                    const rps = parseInt(s.reps) || 0;
                    if (wgt > maxWeight) maxWeight = wgt;
                    
                    const e1rm = getE1RM(wgt, rps);
                    if (e1rm > max1RM) max1RM = e1rm;
                });
            }
        });
    }
    return { maxWeight, max1RM };
}

// --- Workout Duration Timer ---
let workoutDurationInterval = null;
let workoutStartTime = null;

function startWorkoutTimer() {
    workoutStartTime = state.activeWorkout.startTime || Date.now();
    if (!state.activeWorkout.startTime) {
        state.activeWorkout.startTime = workoutStartTime;
    }
    clearInterval(workoutDurationInterval);
    workoutDurationInterval = setInterval(updateWorkoutDurationDisplay, 1000);
    updateWorkoutDurationDisplay();
    const badge = document.getElementById('workoutDurationDisplay');
    if (badge) badge.classList.add('active');
}

function stopWorkoutTimer() {
    clearInterval(workoutDurationInterval);
    workoutDurationInterval = null;
    const badge = document.getElementById('workoutDurationDisplay');
    if (badge) badge.classList.remove('active');
}

function updateWorkoutDurationDisplay() {
    const el = document.getElementById('workoutDurationText');
    if (!el || !workoutStartTime) return;
    const elapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Rest Timer ---
let restTimerInterval = null;
let restTimerRemaining = 0;
let restTimerTotal = 0;

function getRestTimeForExercise(exerciseId) {
    const ex = state.exercises.find(e => e.id === exerciseId);
    return (ex && ex.restTime) ? parseInt(ex.restTime) : 90;
}

function startRestTimer(duration, exerciseName) {
    restTimerTotal = duration;
    restTimerRemaining = duration;
    showRestTimer(exerciseName);
    restTimerInterval = setInterval(runRestTimerTick, 1000);
}

function runRestTimerTick() {
    restTimerRemaining--;
    updateRestTimerDisplay();
    if (restTimerRemaining <= 0) {
        skipRestTimer(true);
        playRestDoneBeep();
    }
}

function updateRestTimerDisplay() {
    const countdown = document.getElementById('restTimerCountdown');
    const ring = document.getElementById('restTimerRingProgress');
    if (!countdown || !ring) return;

    countdown.textContent = restTimerRemaining;

    const circumference = 326.726;
    const progress = restTimerRemaining / restTimerTotal;
    ring.style.strokeDashoffset = circumference * (1 - progress);

    ring.classList.remove('warning', 'urgent');
    if (restTimerRemaining <= 10) ring.classList.add('urgent');
    else if (restTimerRemaining <= 20) ring.classList.add('warning');
}

function showRestTimer(exerciseName) {
    const nameEl = document.getElementById('restTimerExerciseName');
    if (nameEl) nameEl.textContent = exerciseName ? `After: ${escapeHtml(exerciseName)}` : '';
    setModalOpen('restTimerOverlay');
    updateRestTimerDisplay();
}

window.skipRestTimer = function() {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
    setModalClose('restTimerOverlay');
};

window.adjustRestTimer = function(delta) {
    restTimerRemaining = Math.max(1, restTimerRemaining + delta);
    restTimerTotal = Math.max(restTimerTotal, restTimerRemaining);
    updateRestTimerDisplay();
};

function playRestDoneBeep() {
    try {
        const ctx = new(window.AudioContext || window.webkitAudioContext)();
        [0, 0.15, 0.30].forEach(offset => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2);
            osc.start(ctx.currentTime + offset);
            osc.stop(ctx.currentTime + offset + 0.2);
        });
    } catch (e) {}
}

// --- Weight Unit ---
window.setWeightUnit = function(unit) {
    state.weightUnit = unit;
    saveState();
    const lbsBtn = document.getElementById('unitLbs');
    const kgBtn = document.getElementById('unitKg');
    if (lbsBtn) lbsBtn.classList.toggle('active', unit === 'lbs');
    if (kgBtn) kgBtn.classList.toggle('active', unit === 'kg');
    if(state.activeWorkout) renderActiveExercises();
};

function getWeightUnitLabel() {
    return state.weightUnit || 'lbs';
}

// Initialize with Async DB
async function initializeApp() {
    try {
        const savedState = await db.load();

        if (savedState) {
            state = {
                ...state,
                ...savedState
            };
        }
        
        // Migration to week-to-week program support
        if (state.programs && state.programs.length > 0) {
            state.programs.forEach(p => {
                if (p.workouts && !p.schedule) {
                    p.schedule = [];
                    for(let i = 0; i < p.weeks; i++) {
                        p.schedule.push(deepClone(p.workouts));
                    }
                    delete p.workouts;
                }
            });
        }
        
        // Migration: Ensure categories are strictly lowercase and map any missing to 'other'
        if (state.exercises && state.exercises.length > 0) {
            state.exercises.forEach(ex => {
                if (!ex.category) {
                    ex.category = 'other';
                } else {
                    ex.category = ex.category.toLowerCase();
                }
            });

            // Migration: Add Jeff Nippard exercises for existing users
            const nippardExercises = [
                {id: 101, name: 'Bayesian Cable Curl', category: 'biceps', restTime: 60},
                {id: 102, name: 'Cable Y-Raise', category: 'lateral deltoid', restTime: 60},
                {id: 103, name: 'Lean-In Dumbbell Lateral Raise', category: 'lateral deltoid', restTime: 60},
                {id: 104, name: 'Meadows Row', category: 'lats', restTime: 90},
                {id: 105, name: 'Chest-Supported T-Bar Row', category: 'lats', restTime: 90},
                {id: 106, name: 'Deficit Pendlay Row', category: 'lats', restTime: 120},
                {id: 107, name: 'Pendulum Squat', category: 'quadriceps', restTime: 120},
                {id: 108, name: 'Cable Lat Prayers', category: 'lats', restTime: 90},
                {id: 109, name: 'Reverse Cable Crossover', category: 'posterior deltoid', restTime: 60},
                {id: 110, name: 'Katana Cable Triceps Extension', category: 'triceps', restTime: 60},
                {id: 111, name: 'Nautilus Glute Drive', category: 'glutes', restTime: 120}
            ];
            
            nippardExercises.forEach(ne => {
                if (!state.exercises.some(ex => ex.name === ne.name)) {
                    state.exercises.push(ne);
                }
            });
        }
        
        if (!state.exercises || state.exercises.length < 50 || state.exercises.some(e => e.name === '')) {
            state.exercises = [
                {id: 75, name: 'Ab Wheel Rollout', category: 'abs', restTime: 60},
                {id: 26, name: 'Arnold Press', category: 'anterior deltoid', restTime: 90},
                {id: 1, name: 'Barbell Bench Press', category: 'chest', restTime: 120},
                {id: 34, name: 'Barbell Curl', category: 'biceps', restTime: 90},
                {id: 64, name: 'Barbell Hip Thrust', category: 'glutes', restTime: 120},
                {id: 14, name: 'Barbell Row', category: 'lats', restTime: 120},
                {id: 21, name: 'Barbell Shrug', category: 'traps', restTime: 60},
                {id: 79, name: 'Barbell Side Bend', category: 'abs', restTime: 60},
                {id: 51, name: 'Barbell Squat', category: 'quadriceps', restTime: 180},
                {id: 101, name: 'Bayesian Cable Curl', category: 'biceps', restTime: 60},
                {id: 55, name: 'Bulgarian Split Squat', category: 'quadriceps', restTime: 90},
                {id: 74, name: 'Cable Crunch', category: 'abs', restTime: 60},
                {id: 7, name: 'Cable Crossover', category: 'chest', restTime: 60},
                {id: 37, name: 'Cable Curl', category: 'biceps', restTime: 60},
                {id: 81, name: 'Cable Hip Abduction', category: 'other', restTime: 60},
                {id: 83, name: 'Cable Hip Adduction', category: 'other', restTime: 60},
                {id: 108, name: 'Cable Lat Prayers', category: 'lats', restTime: 90},
                {id: 29, name: 'Cable Lateral Raise', category: 'lateral deltoid', restTime: 60},
                {id: 66, name: 'Cable Pull Through', category: 'glutes', restTime: 60},
                {id: 102, name: 'Cable Y-Raise', category: 'lateral deltoid', restTime: 60},
                {id: 105, name: 'Chest-Supported T-Bar Row', category: 'lats', restTime: 90},
                {id: 12, name: 'Chin-Up', category: 'lats', restTime: 120},
                {id: 45, name: 'Close Grip Bench Press', category: 'triceps', restTime: 120},
                {id: 41, name: 'Concentration Curl', category: 'biceps', restTime: 60},
                {id: 71, name: 'Crunch', category: 'abs', restTime: 60},
                {id: 19, name: 'Deadlift', category: 'hamstrings', restTime: 180},
                {id: 5, name: 'Decline Barbell Bench Press', category: 'chest', restTime: 90},
                {id: 77, name: 'Decline Crunch', category: 'abs', restTime: 60},
                {id: 106, name: 'Deficit Pendlay Row', category: 'lats', restTime: 120},
                {id: 2, name: 'Dumbbell Bench Press', category: 'chest', restTime: 120},
                {id: 35, name: 'Dumbbell Curl', category: 'biceps', restTime: 60},
                {id: 9, name: 'Dumbbell Fly', category: 'chest', restTime: 60},
                {id: 47, name: 'Dumbbell Kickback', category: 'triceps', restTime: 60},
                {id: 15, name: 'Dumbbell Row', category: 'lats', restTime: 90},
                {id: 25, name: 'Dumbbell Shoulder Press', category: 'anterior deltoid', restTime: 90},
                {id: 22, name: 'Dumbbell Shrug', category: 'traps', restTime: 60},
                {id: 38, name: 'EZ Bar Curl', category: 'biceps', restTime: 90},
                {id: 32, name: 'Face Pull', category: 'posterior deltoid', restTime: 60},
                {id: 23, name: 'Farmer\'s Walk', category: 'traps', restTime: 90},
                {id: 27, name: 'Front Raise', category: 'anterior deltoid', restTime: 60},
                {id: 54, name: 'Front Squat', category: 'quadriceps', restTime: 120},
                {id: 65, name: 'Glute Kickback', category: 'glutes', restTime: 60},
                {id: 58, name: 'Goblet Squat', category: 'quadriceps', restTime: 90},
                {id: 62, name: 'Good Mornings', category: 'hamstrings', restTime: 120},
                {id: 56, name: 'Hack Squat', category: 'quadriceps', restTime: 120},
                {id: 36, name: 'Hammer Curl', category: 'biceps', restTime: 60},
                {id: 78, name: 'Hanging Knee Raise', category: 'abs', restTime: 60},
                {id: 73, name: 'Hanging Leg Raise', category: 'abs', restTime: 60},
                {id: 80, name: 'Hip Abduction Machine', category: 'other', restTime: 60},
                {id: 82, name: 'Hip Adduction Machine', category: 'other', restTime: 60},
                {id: 3, name: 'Incline Barbell Bench Press', category: 'chest', restTime: 120},
                {id: 4, name: 'Incline Dumbbell Bench Press', category: 'chest', restTime: 120},
                {id: 39, name: 'Incline Dumbbell Curl', category: 'biceps', restTime: 60},
                {id: 110, name: 'Katana Cable Triceps Extension', category: 'triceps', restTime: 60},
                {id: 67, name: 'Kettlebell Swing', category: 'glutes', restTime: 90},
                {id: 13, name: 'Lat Pulldown', category: 'lats', restTime: 90},
                {id: 28, name: 'Lateral Raise', category: 'lateral deltoid', restTime: 60},
                {id: 103, name: 'Lean-In Dumbbell Lateral Raise', category: 'lateral deltoid', restTime: 60},
                {id: 53, name: 'Leg Extension', category: 'quadriceps', restTime: 90},
                {id: 52, name: 'Leg Press', category: 'quadriceps', restTime: 120},
                {id: 70, name: 'Leg Press Calf Raise', category: 'calves', restTime: 60},
                {id: 60, name: 'Lying Leg Curl', category: 'hamstrings', restTime: 90},
                {id: 10, name: 'Machine Chest Press', category: 'chest', restTime: 90},
                {id: 30, name: 'Machine Lateral Raise', category: 'lateral deltoid', restTime: 60},
                {id: 20, name: 'Machine Row', category: 'lats', restTime: 90},
                {id: 104, name: 'Meadows Row', category: 'lats', restTime: 90},
                {id: 111, name: 'Nautilus Glute Drive', category: 'glutes', restTime: 120},
                {id: 24, name: 'Overhead Press', category: 'anterior deltoid', restTime: 120},
                {id: 43, name: 'Overhead Tricep Extension', category: 'triceps', restTime: 60},
                {id: 8, name: 'Pec Deck Fly', category: 'chest', restTime: 60},
                {id: 107, name: 'Pendulum Squat', category: 'quadriceps', restTime: 120},
                {id: 72, name: 'Plank', category: 'abs', restTime: 60},
                {id: 40, name: 'Preacher Curl', category: 'biceps', restTime: 60},
                {id: 11, name: 'Pull-Up', category: 'lats', restTime: 120},
                {id: 6, name: 'Push-Ups', category: 'chest', restTime: 60},
                {id: 50, name: 'Reverse Barbell Curl', category: 'forearms', restTime: 60},
                {id: 109, name: 'Reverse Cable Crossover', category: 'posterior deltoid', restTime: 60},
                {id: 33, name: 'Reverse Dumbbell Fly', category: 'posterior deltoid', restTime: 60},
                {id: 31, name: 'Reverse Pec Deck', category: 'posterior deltoid', restTime: 60},
                {id: 49, name: 'Reverse Wrist Curl', category: 'forearms', restTime: 60},
                {id: 59, name: 'Romanian Deadlift', category: 'hamstrings', restTime: 120},
                {id: 76, name: 'Russian Twist', category: 'abs', restTime: 60},
                {id: 16, name: 'Seated Cable Row', category: 'lats', restTime: 90},
                {id: 68, name: 'Seated Calf Raise', category: 'calves', restTime: 60},
                {id: 61, name: 'Seated Leg Curl', category: 'hamstrings', restTime: 90},
                {id: 44, name: 'Skullcrusher', category: 'triceps', restTime: 90},
                {id: 69, name: 'Standing Calf Raise', category: 'calves', restTime: 60},
                {id: 63, name: 'Stiff-Legged Deadlift', category: 'hamstrings', restTime: 120},
                {id: 18, name: 'Straight Arm Pulldown', category: 'lats', restTime: 60},
                {id: 17, name: 'T-Bar Row', category: 'lats', restTime: 120},
                {id: 46, name: 'Tricep Dips', category: 'triceps', restTime: 90},
                {id: 42, name: 'Tricep Pushdown', category: 'triceps', restTime: 60},
                {id: 57, name: 'Walking Lunges', category: 'quadriceps', restTime: 90},
                {id: 48, name: 'Wrist Curl', category: 'forearms', restTime: 60}
            ];
            await db.save(state);
        }

        // Always ensure exercises are sorted alphabetically globally
        if (state.exercises) {
            state.exercises.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Render UI
        initializeTabs();
        initializeLibraryTabs();
        resetLibraryTabs();
        initializeModals();
        renderTrainingTab();
        renderProgressDashboard();
        renderProgramsList();
        renderStandaloneWorkoutsList();
        renderExercisesList();
        renderBodyweight();
        renderSettingsPreferences();

        // 4️⃣ Workout Resume Detection
        if (state.activeWorkout) {
            openActiveWorkout();
            showToast("Resumed incomplete workout!");
        }

    } catch (err) {
        console.error("Init failed:", err);
    }
}

async function saveState() {
    const stateToSave = {
        exercises: state.exercises,
        programs: state.programs,
        standaloneWorkouts: state.standaloneWorkouts,
        currentProgram: state.currentProgram,
        currentWeek: state.currentWeek,
        workoutHistory: state.workoutHistory,
        bodyweightHistory: state.bodyweightHistory,
        activeWorkout: state.activeWorkout,
        weightUnit: state.weightUnit
    };
    await db.save(stateToSave);
}

const debouncedSaveState = debounce(saveState, 1000);

window.resetApp = async function() {
    if (confirm("Are you sure you want to wipe all data? This cannot be undone.")) {
        await db.clear();
        location.reload();
    }
}

// --- Import / Export ---
window.exportData = async function() {
    const data = await db.load();
    if (!data) return alert("No data to export.");
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", `workouts_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadNode);
    downloadNode.click();
    downloadNode.remove();
};

window.importData = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState && importedState.exercises) {
                await db.save(importedState);
                alert("Database imported successfully!");
                location.reload();
            } else {
                alert("Invalid file format.");
            }
        } catch (err) {
            alert("Error parsing file.");
        }
    };
    reader.readAsText(file);
};

// --- Bodyweight Tracker ---
window.logBodyweight = function() {
    const val = document.getElementById('bwInput').value;
    if (!val) return;
    state.bodyweightHistory.push({
        id: Date.now(),
        date: new Date().toISOString(),
        weight: parseFloat(val)
    });
    saveState();
    renderBodyweight();
    document.getElementById('bwInput').value = '';
};

window.deleteBodyweight = function(id) {
    if (confirm("Delete this weight log?")) {
        state.bodyweightHistory = state.bodyweightHistory.filter(b => b.id !== id);
        saveState();
        renderBodyweight();
    }
};

window.editBodyweight = function(id) {
    const entry = state.bodyweightHistory.find(b => b.id === id);
    if (!entry) return;
    let newWeight = prompt("Enter new weight:", entry.weight);
    if (newWeight !== null) {
        newWeight = newWeight.trim().substring(0, 10); // Secure length constraint
        if (!isNaN(parseFloat(newWeight))) {
            entry.weight = parseFloat(newWeight);
            saveState();
            renderBodyweight();
        }
    }
};

function renderBodyweight() {
    const container = document.getElementById('bwHistory');
    if (!container) return;
    if (!state.bodyweightHistory || state.bodyweightHistory.length === 0) {
        container.innerHTML = "No bodyweight logs yet.";
        return;
    }
    const sorted = [...state.bodyweightHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = sorted.map(b => `
        <div class="flex justify-between items-center py-2 border-b">
            <span>${new Date(b.date).toLocaleDateString()}</span>
            <div class="flex items-center gap-2">
                <span class="font-bold text-primary mr-2">${b.weight}</span>
                <button class="btn-icon-xs" onclick="editBodyweight(${b.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="btn-icon-xs btn-transparent-danger" onclick="deleteBodyweight(${b.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `).join('');
}

document.addEventListener('DOMContentLoaded', initializeApp);

// --- Tabs ---
function initializeTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            
            const tabElement = document.getElementById(tabName);
            if(tabElement) tabElement.classList.add('active');

            if (tabName === 'library') {
                resetLibraryTabs();
            }
            if (tabName === 'progress') {
                renderProgressDashboard();
            }
        });
    });
}

function resetLibraryTabs() {
    const programContent = document.getElementById('programs');
    const workoutContent = document.getElementById('standalone-workouts');
    const exerciseContent = document.getElementById('exercises');

    const programBtn = document.querySelector('[data-library-tab="programs"]');
    const workoutBtn = document.querySelector('[data-library-tab="standalone-workouts"]');
    const exerciseBtn = document.querySelector('[data-library-tab="exercises"]');

    if (programContent && exerciseContent && workoutContent) {
        programContent.classList.remove('hidden');
        programContent.classList.add('active');

        workoutContent.classList.add('hidden');
        workoutContent.classList.remove('active');

        exerciseContent.classList.add('hidden');
        exerciseContent.classList.remove('active');
    }

    if (programBtn && exerciseBtn && workoutBtn) {
        programBtn.classList.add('active');
        workoutBtn.classList.remove('active');
        exerciseBtn.classList.remove('active');
    }
}

function initializeLibraryTabs() {
    const libraryTabBtns = document.querySelectorAll('.library-tab-btn');
    const libraryContents = document.querySelectorAll('.library-content');

    libraryTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.libraryTab;

            libraryTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            libraryContents.forEach(content => {
                content.classList.remove('active');
                content.classList.add('hidden');
            });

            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.remove('hidden');
                targetEl.classList.add('active');
            }
        });
    });
}

// --- Modals & Event Listeners ---
function initializeModals() {
    attachListener('createProgramBtn', 'click', () => openProgramBuilder());
    attachListener('closeProgramModal', 'click', closeProgramBuilder);
    attachListener('cancelProgramBtn', 'click', closeProgramBuilder);
    attachListener('saveProgramBtn', 'click', saveProgram);
    attachListener('addWorkoutBtn', 'click', addWorkoutToProgram);
    attachListener('addRestDayBtn', 'click', addRestDayToProgram);

    attachListener('createStandaloneBtn', 'click', () => openWorkoutBuilder(null, null, 'standalone'));
    attachListener('createStandaloneLibBtn', 'click', () => openWorkoutBuilder(null, null, 'standalone'));

    attachListener('closeWorkoutModal', 'click', closeWorkoutBuilder);
    attachListener('cancelWorkoutBtn', 'click', closeWorkoutBuilder);
    attachListener('saveWorkoutBtn', 'click', saveWorkout);
    attachListener('addExerciseToWorkoutBtn', 'click', () => openExerciseSelection('workoutBuilder'));

    attachListener('closeExerciseSelectionModal', 'click', closeExerciseSelection);
    attachListener('exerciseSelectionSearch', 'input', filterExerciseSelection);
    attachListener('confirmExerciseSelectionBtn', 'click', confirmExerciseSelection);

    attachListener('createExerciseBtn', 'click', openAddExercise);
    attachListener('closeAddExerciseModal', 'click', closeAddExercise);
    attachListener('cancelExerciseBtn', 'click', closeAddExercise);
    attachListener('saveExerciseBtn', 'click', saveExercise);

    attachListener('closeActiveWorkoutModal', 'click', closeActiveWorkout);
    attachListener('finishWorkoutBtn', 'click', finishWorkout);
    attachListener('discardWorkoutBtn', 'click', discardWorkout);
    attachListener('addExerciseToActiveBtn', 'click', () => openExerciseSelection('activeWorkout'));

    attachListener('workoutNotes', 'input', (e) => {
        if (state.activeWorkout) {
            // Trim heavily on typing string cache to avoid UI freezing memory bloat
            state.activeWorkout.notes = String(e.target.value).substring(0, 2000); 
            debouncedSaveState();
        }
    });

    attachListener('openHistoryBtn', 'click', openHistoryModal);
    attachListener('closeHistoryModal', 'click', closeHistoryModal);

    attachListener('selectProgramBtn', 'click', () => {
        const libBtn = document.querySelector('.tab-btn[data-tab="library"]');
        if (libBtn) libBtn.click();
    });
    attachListener('quickLogBtn', 'click', startQuickWorkout);
    attachListener('exerciseSearch', 'input', filterExercises);
}

// --- Progress Dashboard Logic ---
function renderProgressDashboard() {
    document.getElementById('progTotalWorkouts').textContent = state.workoutHistory.length;
    
    let totalVol = 0;
    let prs = [];
    
    state.workoutHistory.forEach(w => {
        w.exercises.forEach(ex => {
            const exerciseData = state.exercises.find(e => e.id === ex.exerciseId);
            const exName = exerciseData ? exerciseData.name : 'Unknown';
            
            ex.sets.forEach(s => {
                totalVol += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0);
            });
        });
    });
    
    // Recalculate all-time PRs manually since prsTriggered array was added recently
    state.exercises.forEach(ex => {
        const maxes = getExerciseMaxes(ex.id);
        if (maxes.maxWeight > 0) {
            prs.push({ exerciseName: ex.name, type: 'Weight', value: maxes.maxWeight });
        }
    });

    document.getElementById('progTotalVolume').textContent = totalVol.toLocaleString();
    document.getElementById('progStreak').textContent = calculateStreak();
    document.getElementById('progTotalPRs').textContent = prs.length;

    const prList = document.getElementById('prDashboardList');
    prList.innerHTML = '';
    
    if (prs.length === 0) {
        prList.innerHTML = '<div class="empty-state" style="border:none;">Keep lifting to set some Personal Records!</div>';
    } else {
        // Sort PRs alphabetically
        prs.sort((a,b) => a.exerciseName.localeCompare(b.exerciseName));
        prs.forEach(pr => {
            prList.innerHTML += `
                <div class="flex justify-between items-center py-3 px-4 border-b border-border-light">
                    <span class="font-medium">${escapeHtml(pr.exerciseName)}</span>
                    <span class="badge badge-warning">${pr.type} PR: ${pr.value}</span>
                </div>
            `;
        });
    }
}

// --- History Logic ---
function openHistoryModal() {
    setModalOpen('historyModal');
    renderHistory();
}

function closeHistoryModal() {
    setModalClose('historyModal');
}

window.deleteHistoryWorkout = function(id) {
    if (confirm("Are you sure you want to delete this workout log?")) {
        state.workoutHistory = state.workoutHistory.filter(w => w.id !== id);
        saveState();
        renderHistory();
        renderTrainingTab(); // Re-render streak if needed
    }
};

window.editHistoryWorkout = function(id) {
    const record = state.workoutHistory.find(w => w.id === id);
    if (!record) return;

    state.activeWorkout = deepClone(record);
    state.activeWorkout.historyId = id;

    saveState();
    closeHistoryModal();
    openActiveWorkout();
};

function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';

    if (state.workoutHistory.length === 0) {
        list.innerHTML = '<div class="empty-state">No history yet.</div>';
        return;
    }

    const sorted = [...state.workoutHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex.name]));

    sorted.forEach(record => {
        const date = new Date(record.date).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        const notesHTML = record.notes ? `<div class="history-card-notes">"${escapeHtml(record.notes)}"</div>` : '';

        const card = document.createElement('div');
        card.className = 'card';

        let exercisesHTML = '';
        record.exercises.forEach(ex => {
            const exerciseName = exercisesMap.get(ex.exerciseId) || 'Unknown Exercise';
            const bestSet = ex.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, ex.sets[0]);

            let setsDetails = '<div class="w-full flex flex-col gap-1">';
            ex.sets.forEach((set, i) => {
                const weightStr = set.weight ? `${escapeHtml(String(set.weight))}${getWeightUnitLabel()}` : 'BW';
                setsDetails += `<div class="flex justify-between text-sm text-secondary px-2">
                    <span>Set ${i+1}: ${weightStr} × ${escapeHtml(String(set.reps || 0))}</span>
                </div>`;
                if (set.note) {
                    setsDetails += `<div class="text-xs text-tertiary italic ml-4 pl-2 mb-1" style="border-left: 2px solid var(--border);">Note: ${escapeHtml(set.note)}</div>`;
                }
            });
            setsDetails += '</div>';

            exercisesHTML += `
                <div class="history-card-row">
                    <div class="flex justify-between items-center w-full mb-2">
                        <span class="font-bold text-primary">${escapeHtml(exerciseName)}</span>
                        <span class="text-xs text-secondary">${ex.sets.length} sets • Best: ${bestSet && bestSet.weight ? escapeHtml(String(bestSet.weight)) : 0}</span>
                    </div>
                    ${setsDetails}
                </div>
            `;
        });

        const progWeekInfo = record.programId ? ` • Week ${record.week || 1}` : '';

        card.innerHTML = `
            <div class="flex justify-between items-center mb-2 border-b pb-2">
                <h3 class="text-lg">${escapeHtml(record.name)}</h3>
                <span class="text-secondary text-sm">${date}${progWeekInfo}</span>
            </div>
            <div>
                ${exercisesHTML}
            </div>
            ${notesHTML}
            <div class="flex gap-2 mt-4 pt-2 border-t">
                <button class="btn-secondary btn-sm flex-grow" onclick="editHistoryWorkout(${record.id})">Edit</button>
                <button class="btn-text-danger btn-sm" onclick="deleteHistoryWorkout(${record.id})">Delete</button>
            </div>
        `;
        list.appendChild(card);
    });
}

// --- Training Tab Logic ---
function getLastWorkoutDate(templateName, programId) {
    const matches = state.workoutHistory.filter(w => {
        if (programId) return w.programId === programId && w.name === templateName;
        return w.name === templateName;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    return new Date(matches[0].date);
}

function formatLastDone(date) {
    if (!date) return null;
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays/7)}w ago`;
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    });
}

function calculateStreak() {
    if (!state.workoutHistory || state.workoutHistory.length === 0) return 0;
    
    // Extract unique local dates
    const dates = [...new Set(state.workoutHistory.map(w => {
        const d = new Date(w.date);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }))].sort((a, b) => new Date(b) - new Date(a)); // sort desc

    let streak = 0;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    // Streak is alive if user worked out today or yesterday
    if (dates[0] === todayStr || dates[0] === yesterdayStr) {
        streak = 1;
        let checkDate = new Date(dates[0]);
        
        for (let i = 1; i < dates.length; i++) {
            checkDate.setDate(checkDate.getDate() - 1);
            const expectedStr = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
            if (dates[i] === expectedStr) {
                streak++;
            } else {
                break;
            }
        }
    }
    return streak;
}

function renderTrainingTab() {
    const container = document.getElementById('training');
    const programNameEl = document.getElementById('programName');
    const programWeekEl = document.getElementById('programWeek');
    const standaloneListEl = document.getElementById('standaloneWorkoutListTraining');
    const streakBadge = document.getElementById('workoutStreakBadge');
    const streakText = document.getElementById('workoutStreakText');

    if (!container) return;
    
    // Render Streak
    const streak = calculateStreak();
    if (streak > 0 && streakBadge && streakText) {
        streakBadge.classList.remove('hidden');
        streakText.textContent = `${streak} Day Streak`;
    } else if (streakBadge) {
        streakBadge.classList.add('hidden');
    }

    const resumeCardId = 'resumeWorkoutCard';
    let resumeCard = document.getElementById(resumeCardId);

    if (state.activeWorkout) {
        if (!resumeCard) {
            resumeCard = document.createElement('div');
            resumeCard.id = resumeCardId;
            resumeCard.className = 'resume-card mb-4';
            const header = container.querySelector('.header');
            header.after(resumeCard);
        }
        resumeCard.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <div class="resume-card-tag">IN PROGRESS</div>
                    <h3>${escapeHtml(state.activeWorkout.name)}</h3>
                    <p>Tap to resume</p>
                </div>
                <button class="btn-icon-sm" style="background:var(--warning); color:black; border:none;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
            </div>
        `;
        resumeCard.onclick = () => openActiveWorkout();
    } else {
        if (resumeCard) resumeCard.remove();
    }

    if (!state.currentProgram) {
        if (programNameEl) programNameEl.textContent = 'No Program Selected';
        if (programWeekEl) programWeekEl.textContent = 'Select in Library to see here.';
        const weekControls = document.getElementById('weekControls');
        if (weekControls) weekControls.style.display = 'none';
        const progWorkoutSection = document.getElementById('programWorkoutSection');
        if (progWorkoutSection) progWorkoutSection.style.display = 'none';
    } else {
        const program = state.programs.find(p => p.id === state.currentProgram);
        if (!program) {
            state.currentProgram = null;
            saveState();
            renderTrainingTab();
            return;
        }

        // Fallback sync
        if (state.currentWeek > program.weeks) {
            state.currentWeek = program.weeks;
            saveState();
        }

        if (programNameEl) programNameEl.textContent = escapeHtml(program.name);
        if (programWeekEl) programWeekEl.textContent = `Week ${state.currentWeek} of ${program.weeks}`;

        let weekControls = document.getElementById('weekControls');
        if (!weekControls) {
            weekControls = document.createElement('div');
            weekControls.id = 'weekControls';
            weekControls.className = 'week-controls';
            const dashCard = container.querySelector('.program-dashboard-card');
            if (dashCard) dashCard.appendChild(weekControls);
        }
        weekControls.style.display = 'flex';
        weekControls.innerHTML = `
            <button class="week-btn" onclick="retreatWeek()" ${state.currentWeek <= 1 ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="week-progress">
                <div class="week-progress-bar" style="width:${(state.currentWeek / program.weeks) * 100}%"></div>
            </div>
            <button class="week-btn" onclick="advanceWeek()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        `;

        let progSection = document.getElementById('programWorkoutSection');
        if (!progSection) {
            progSection = document.createElement('div');
            progSection.id = 'programWorkoutSection';
            const dashCard = container.querySelector('.program-dashboard-card');
            dashCard.after(progSection);
        }
        progSection.style.display = 'block';

        let currentWeekIndex = state.currentWeek - 1;
        let currentWorkouts = program.schedule[currentWeekIndex] || [];

        if (currentWorkouts.length === 0) {
            progSection.innerHTML = '<div class="empty-state">No workouts for this week.</div>';
        } else {
            let rows = '';
            currentWorkouts.forEach((workout, i) => {
                if (workout.isRestDay) {
                    rows += `
                        <div class="program-workout-row" style="background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px; border: 1px dashed var(--border);">
                            <div class="program-workout-info">
                                <div class="font-bold text-secondary flex items-center gap-2">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                                    Rest Day
                                </div>
                            </div>
                        </div>
                    `;
                    return;
                }

                const lastDate = getLastWorkoutDate(workout.name, program.id);
                const lastDoneStr = formatLastDone(lastDate);
                const setTotal = workout.exercises.reduce((acc, ex) => acc + (ex.sets ? ex.sets.length : 0), 0);
                rows += `
                    <div class="program-workout-row">
                        <div class="program-workout-info">
                            <div class="font-bold">${escapeHtml(workout.name)}</div>
                            <div class="text-secondary text-xs mt-1">${workout.exercises.length} ex • ${setTotal} sets${lastDoneStr ? ` • ${lastDoneStr}` : ''}</div>
                        </div>
                        <button class="btn-secondary btn-sm" onclick="startProgramWorkout(${program.id}, ${i})">Start</button>
                    </div>
                `;
            });
            progSection.innerHTML = `
                <div class="section-title mt-0"><h3>This Week</h3></div>
                <div class="card">${rows}</div>
            `;
        }
    }

    if (standaloneListEl) {
        standaloneListEl.innerHTML = '';
        if (!state.standaloneWorkouts || state.standaloneWorkouts.length === 0) {
            standaloneListEl.innerHTML = '<div class="empty-state">Design custom routines in the Library tab.</div>';
        } else {
            state.standaloneWorkouts.forEach((workout) => {
                const card = document.createElement('div');
                card.className = 'workout-card';
                const setTotal = workout.exercises.reduce((acc, ex) => acc + (ex.sets ? ex.sets.length : 0), 0);
                const lastDate = getLastWorkoutDate(workout.name, null);
                const lastDoneStr = formatLastDone(lastDate);

                card.innerHTML = `
                    <div class="workout-card-header">
                        <h3>${escapeHtml(workout.name)}</h3>
                    </div>
                    <div class="workout-card-meta">
                        ${workout.exercises.length} exercises • ${setTotal} sets${lastDoneStr ? ` • ${lastDoneStr}` : ''}
                    </div>
                `;
                card.addEventListener('click', () => startStandaloneWorkout(workout.id));
                standaloneListEl.appendChild(card);
            });
        }
    }
}

// Helper to auto-fill prior weights/reps
function getAutoFillForExercise(exerciseId, setIndex) {
    const matches = [];
    state.workoutHistory.forEach(workout => {
        const ex = workout.exercises.find(e => e.exerciseId === exerciseId);
        if (ex) matches.push({ date: workout.date, sets: ex.sets });
    });
    if (matches.length === 0) return null;
    
    // Sort to get newest
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastSession = matches[0];
    
    if (lastSession.sets[setIndex]) return lastSession.sets[setIndex];
    if (lastSession.sets.length > 0) return lastSession.sets[lastSession.sets.length - 1]; // fallback
    return null;
}

// 1️⃣ Action to Auto-Fill all sets for an exercise actively in workout
window.autofillExerciseSets = function(exIndex) {
    const exerciseId = state.activeWorkout.exercises[exIndex].exerciseId;
    const matches = [];
    
    state.workoutHistory.forEach(workout => {
        const ex = workout.exercises.find(e => e.exerciseId === exerciseId);
        if (ex) matches.push({ date: workout.date, sets: ex.sets });
    });
    
    if (matches.length > 0) {
        matches.sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastSets = matches[0].sets;
        
        state.activeWorkout.exercises[exIndex].sets = lastSets.map(s => ({
            weight: s.weight || '',
            reps: s.reps || '',
            targetReps: s.reps || '',
            note: '',
            completed: false
        }));
        
        saveState();
        renderActiveExercises();
        showToast("Auto-filled past performance 🔄");
    }
};

window.startProgramWorkout = function(programId, index) {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const program = state.programs.find(p => p.id === programId);
    let currentWeekIndex = (state.currentWeek || 1) - 1;
    if (currentWeekIndex >= program.weeks) currentWeekIndex = program.weeks - 1;
    
    const template = program.schedule[currentWeekIndex][index];

    const sessionExercises = template.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        restTime: ex.restTime !== undefined ? ex.restTime : getRestTimeForExercise(ex.exerciseId),
        sets: Array.isArray(ex.sets) ? ex.sets.map((s, i) => {
            const autofill = getAutoFillForExercise(ex.exerciseId, i);
            return {
                weight: autofill && autofill.weight ? autofill.weight : '',
                targetReps: s.reps || '',
                reps: autofill && autofill.reps ? autofill.reps : '',
                note: '',
                completed: false
            }
        }) : []
    }));

    state.activeWorkout = {
        type: 'program',
        programId: program.id,
        workoutIndex: index,
        week: currentWeekIndex + 1,
        name: template.name,
        exercises: sessionExercises,
        notes: '',
        prsTriggered: {},
        prs: []
    };

    saveState();
    openActiveWorkout();

    const tabBtn = document.querySelector('.tab-btn[data-tab="training"]');
    if (tabBtn) tabBtn.click();
}

function startStandaloneWorkout(id) {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const template = state.standaloneWorkouts.find(w => w.id === id);
    if (!template) return;

    const sessionExercises = template.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        restTime: ex.restTime !== undefined ? ex.restTime : getRestTimeForExercise(ex.exerciseId),
        sets: Array.isArray(ex.sets) ? ex.sets.map((s, i) => {
            const autofill = getAutoFillForExercise(ex.exerciseId, i);
            return {
                weight: autofill && autofill.weight ? autofill.weight : '',
                targetReps: s.reps || '',
                reps: autofill && autofill.reps ? autofill.reps : '',
                note: '',
                completed: false
            }
        }) : []
    }));

    state.activeWorkout = {
        type: 'standalone',
        standaloneWorkoutId: id,
        name: template.name,
        exercises: sessionExercises,
        notes: '',
        prsTriggered: {},
        prs: []
    };

    saveState();
    openActiveWorkout();
}

function startQuickWorkout() {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const namePrompt = prompt("Name this workout:", "Quick Workout");
    if (namePrompt === null) return; 
    
    // Secure input limiting
    const safeName = namePrompt.trim().substring(0, 100) || 'Quick Workout';

    state.activeWorkout = {
        type: 'freestyle',
        name: safeName,
        exercises: [],
        notes: '',
        prsTriggered: {},
        prs: []
    };
    saveState();
    openActiveWorkout();
}

// --- Active Workout / Logging Logic ---
function openActiveWorkout() {
    setModalOpen('activeWorkoutModal');
    document.getElementById('activeWorkoutTitle').textContent = escapeHtml(state.activeWorkout.name);
    document.getElementById('workoutNotes').value = state.activeWorkout.notes || '';

    // Initialize tracking objects if missing
    if (!state.activeWorkout.prsTriggered) state.activeWorkout.prsTriggered = {};
    if (!state.activeWorkout.prs) state.activeWorkout.prs = [];

    renderActiveExercises();
    renderTrainingTab();
    startWorkoutTimer();
}

function closeActiveWorkout() {
    setModalClose('activeWorkoutModal');
    stopWorkoutTimer();
    renderTrainingTab();
}

function getLastExercisePerformance(exerciseId) {
    const matches = [];
    state.workoutHistory.forEach(workout => {
        const ex = workout.exercises.find(e => e.exerciseId === exerciseId);
        if (ex) {
            matches.push({
                date: workout.date,
                sets: ex.sets
            });
        }
    });

    if (matches.length === 0) return null;

    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = matches[0];
    const bestSet = last.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, last.sets[0]);

    return {
        weight: bestSet.weight,
        reps: bestSet.reps
    };
}

window.updateActiveExerciseRest = function(exIndex, val) {
    // Substring cap before integer parsing to prevent overflows
    state.activeWorkout.exercises[exIndex].restTime = parseInt(String(val).substring(0, 4)) || 0;
    debouncedSaveState();
}

// 3️⃣ Quick Weight Adjustment Logic
window.quickAdjustExerciseWeight = function(exIndex, amount) {
    state.activeWorkout.exercises[exIndex].sets.forEach(set => {
        let w = parseFloat(set.weight) || 0;
        w += amount;
        if (w < 0) w = 0;
        set.weight = w;
    });
    saveState();
    renderActiveExercises();
};

function renderActiveExercises() {
    const list = document.getElementById('activeExercisesList');
    list.innerHTML = '';

    if (state.activeWorkout.exercises.length === 0) {
        list.innerHTML = '<div class="empty-state">No exercises added yet.<br>Tap "+ Add Exercise" to begin.</div>';
        return;
    }

    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));

    state.activeWorkout.exercises.forEach((exercise, exIndex) => {
        const exerciseData = exercisesMap.get(exercise.exerciseId);
        const card = document.createElement('div');
        card.className = 'workout-card';

        const exName = exerciseData ? escapeHtml(exerciseData.name) : 'Unknown Exercise';
        
        const lastPerf = getLastExercisePerformance(exercise.exerciseId);
        let lastPerfHTML = `<span class="text-xs text-secondary mt-2 mb-1 inline-block">New Exercise</span>`;
        let autofillBtn = ``;
        
        if (lastPerf) {
            const e1rm = getE1RM(lastPerf.weight, lastPerf.reps);
            lastPerfHTML = `
                <div class="flex items-center gap-2 mt-2 mb-1 flex-wrap">
                    <span class="badge badge-primary">Last: ${escapeHtml(String(lastPerf.weight))} x ${escapeHtml(String(lastPerf.reps))}</span>
                    <span class="badge badge-secondary" style="background:var(--surface); border-color:var(--border-light);">E1RM: ${e1rm}</span>
                </div>
            `;
            // Add autofill button since history exists
            autofillBtn = `
                <button class="btn-sm btn-secondary mb-2" onclick="autofillExerciseSets(${exIndex})">
                    🔄 Auto-Fill
                </button>
            `;
        }

        const restTime = exercise.restTime !== undefined ? exercise.restTime : (exerciseData ? exerciseData.restTime : 90);
        
        const restBadge = `
            <div class="flex items-center gap-1 mt-1" style="color: white;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <input type="text" inputmode="numeric" 
                       style="width: 32px; background: transparent; border: 1px solid var(--border); color: white; font-size: 10px; font-weight: bold; text-align: center; border-radius: 4px; padding: 2px; margin: 0 4px;" 
                       value="${restTime}" 
                       oninput="enforceNumeric(this, false); updateActiveExerciseRest(${exIndex}, this.value)">
                <span class="text-[10px] font-bold uppercase tracking-wider">s rest</span>
            </div>`;

        let setsHTML = `
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="text-lg mb-0">${exName}</h3>
                    <div class="flex flex-col items-start">
                        ${lastPerfHTML}
                        ${restBadge}
                    </div>
                </div>
                <div class="flex flex-col items-end gap-2">
                    <button class="btn-icon-sm btn-transparent-danger" onclick="removeActiveExercise(${exIndex})">
                       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            
            <div class="flex justify-between w-full mb-4 mt-2">
                ${autofillBtn}
            </div>

            <div class="quick-adjust-bar">
                <button class="quick-adjust-btn" onclick="quickAdjustExerciseWeight(${exIndex}, -10)">-10</button>
                <button class="quick-adjust-btn" onclick="quickAdjustExerciseWeight(${exIndex}, -5)">-5</button>
                <button class="quick-adjust-btn" onclick="quickAdjustExerciseWeight(${exIndex}, 5)">+5</button>
                <button class="quick-adjust-btn" onclick="quickAdjustExerciseWeight(${exIndex}, 10)">+10</button>
            </div>

            <div class="set-row mb-2">
                <span class="set-header text-center">Set</span>
                <span class="set-header text-center">${getWeightUnitLabel().toUpperCase()}</span>
                <span class="set-header text-center">Reps</span>
                <span class="set-header text-center">Done</span>
            </div>
        `;

        exercise.sets.forEach((set, setIndex) => {
            setsHTML += `
                <div class="set-row">
                    <span class="text-center text-secondary font-bold text-sm">${setIndex + 1}</span>
                    <input type="text" inputmode="decimal" value="${set.weight !== undefined ? escapeHtml(String(set.weight)) : ''}" placeholder="-" 
                        oninput="enforceNumeric(this, true); updateActiveSet(${exIndex}, ${setIndex}, 'weight', this.value)">
                    <input type="text" inputmode="numeric" value="${set.reps !== undefined ? escapeHtml(String(set.reps)) : ''}" placeholder="${set.targetReps ? escapeHtml(String(set.targetReps)) : '-'}" 
                        oninput="enforceNumeric(this, false); updateActiveSet(${exIndex}, ${setIndex}, 'reps', this.value)">
                    <button class="set-btn ${set.completed ? 'completed' : ''}" 
                        onclick="toggleSetComplete(${exIndex}, ${setIndex})">
                        ${set.completed ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                    </button>
                </div>
                <textarea class="input-field set-note-input" rows="2" placeholder="Note for Set ${setIndex + 1}..." oninput="updateActiveSet(${exIndex}, ${setIndex}, 'note', this.value)">${set.note ? escapeHtml(set.note) : ''}</textarea>
            `;
        });

        card.innerHTML = `
            ${setsHTML}
            <button class="btn-dashed mt-4" onclick="addSetToActive(${exIndex})">+ Add Set</button>
        `;
        list.appendChild(card);
    });
}

window.updateActiveSet = function(exIndex, setIndex, field, value) {
    // Security: Clamping text inputs securely before updating local state
    if (typeof value === 'string') {
        if (field === 'note') value = value.substring(0, 1000);
        if (field === 'weight') value = value.substring(0, 10);
        if (field === 'reps') value = value.substring(0, 10);
    }
    state.activeWorkout.exercises[exIndex].sets[setIndex][field] = value;
    debouncedSaveState();
};

window.toggleSetComplete = function(exIndex, setIndex) {
    const set = state.activeWorkout.exercises[exIndex].sets[setIndex];
    const wasCompleted = set.completed;
    set.completed = !set.completed;
    renderActiveExercises();
    saveState();

    if (!wasCompleted && set.completed) {
        // 1. Check for PR
        const exercise = state.activeWorkout.exercises[exIndex];
        const exerciseData = state.exercises.find(e => e.id === exercise.exerciseId);
        const wgt = parseFloat(set.weight) || 0;
        const rps = parseInt(set.reps) || 0;
        
        if (exerciseData && wgt > 0 && rps > 0) {
            const e1rm = getE1RM(wgt, rps);
            const maxes = getExerciseMaxes(exerciseData.id);
            
            let prType = null;
            if (wgt > maxes.maxWeight) prType = 'Weight';
            else if (e1rm > maxes.max1RM) prType = '1RM';

            if (prType) {
                const prKey = `${exerciseData.id}_${prType}`;
                if (!state.activeWorkout.prsTriggered[prKey]) {
                    showToast(`New ${prType} PR for ${exerciseData.name}! 🎉`);
                    state.activeWorkout.prsTriggered[prKey] = true;
                    state.activeWorkout.prs.push({
                        exerciseName: exerciseData.name,
                        type: prType,
                        value: prType === 'Weight' ? wgt : e1rm
                    });
                    saveState();
                }
            }
        }

        // 2. Start Rest Timer
        const exerciseName = exerciseData ? exerciseData.name : 'Exercise';
        const duration = exercise.restTime !== undefined ? exercise.restTime : (exerciseData ? exerciseData.restTime : 90);
        startRestTimer(duration, exerciseName);
    }
};

window.addSetToActive = function(exIndex) {
    const previousSet = state.activeWorkout.exercises[exIndex].sets[state.activeWorkout.exercises[exIndex].sets.length - 1];
    state.activeWorkout.exercises[exIndex].sets.push({
        weight: previousSet ? previousSet.weight : '',
        reps: '',
        targetReps: previousSet ? previousSet.targetReps : '',
        note: '',
        completed: false
    });
    renderActiveExercises();
    saveState();
};

window.removeActiveExercise = function(exIndex) {
    if (confirm('Remove this exercise?')) {
        state.activeWorkout.exercises.splice(exIndex, 1);
        renderActiveExercises();
        saveState();
    }
};

function discardWorkout() {
    if (confirm("Are you sure you want to cancel this workout? All progress will be discarded.")) {
        state.activeWorkout = null;
        saveState();
        stopWorkoutTimer();
        setModalClose('activeWorkoutModal');
        renderTrainingTab();
    }
}

function finishWorkout() {
    const completedExercises = state.activeWorkout.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        sets: ex.sets.filter(s => s.completed || (s.weight && s.reps))
    })).filter(ex => ex.sets.length > 0);

    if (completedExercises.length === 0) {
        alert("You haven't logged any sets!");
        return;
    }

    let volume = 0;
    completedExercises.forEach(ex => {
        ex.sets.forEach(s => {
            volume += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0);
        });
    });

    const durationMins = workoutStartTime ? Math.floor((Date.now() - workoutStartTime) / 60000) : 0;
    
    // Secure trim & character limit to maintain DB health for Notes
    const safeNotes = typeof state.activeWorkout.notes === 'string' ? state.activeWorkout.notes.trim().substring(0, 2000) : '';

    if (state.activeWorkout.historyId) {
        const index = state.workoutHistory.findIndex(w => w.id === state.activeWorkout.historyId);
        if (index !== -1) {
            state.workoutHistory[index].exercises = completedExercises;
            state.workoutHistory[index].notes = safeNotes;
        }
    } else {
        const record = {
            id: Date.now(),
            date: new Date().toISOString(),
            programId: state.activeWorkout.programId || null,
            workoutIndex: state.activeWorkout.workoutIndex,
            week: state.activeWorkout.week || 1,
            name: state.activeWorkout.name,
            exercises: completedExercises,
            notes: safeNotes
        };
        state.workoutHistory.push(record);
    }

    const wName = state.activeWorkout.name;
    const prs = state.activeWorkout.prs || [];

    state.activeWorkout = null;
    saveState();
    stopWorkoutTimer();

    setModalClose('activeWorkoutModal');
    renderHistory();
    renderTrainingTab();
    
    showSummaryModal(wName, durationMins, volume, prs);
}

function showSummaryModal(name, durationMins, volume, prs) {
    document.getElementById('summaryWorkoutName').textContent = escapeHtml(name);
    document.getElementById('summaryDuration').textContent = `${durationMins}m`;
    document.getElementById('summaryVolume').textContent = `${volume.toLocaleString()} ${getWeightUnitLabel()}`;
    
    const prSection = document.getElementById('summaryPRsSection');
    const prList = document.getElementById('summaryPRList');
    
    if (prs && prs.length > 0) {
        prSection.classList.remove('hidden');
        prList.innerHTML = prs.map(pr => `
            <div class="flex justify-between items-center bg-surface p-3 rounded-md border border-border">
                <span class="font-bold">${escapeHtml(pr.exerciseName)}</span>
                <span class="badge badge-warning">${escapeHtml(pr.type)} PR: ${escapeHtml(String(pr.value))}</span>
            </div>
        `).join('');
    } else {
        prSection.classList.add('hidden');
    }
    
    setModalOpen('workoutSummaryModal');
}

// --- Program Builder Logic ---
function openProgramBuilder(programToEdit = null) {
    setModalOpen('programBuilderModal');
    const title = document.getElementById('modalTitle');
    state.editingProgramWeek = 0; // Reset to Week 1

    if (programToEdit) {
        title.textContent = 'Edit Program';
        state.editingProgram = deepClone(programToEdit);
        
        // Safety migration inside modal open just in case
        if (state.editingProgram.workouts && !state.editingProgram.schedule) {
            state.editingProgram.schedule = [];
            for(let i=0; i<state.editingProgram.weeks; i++) {
                state.editingProgram.schedule.push(deepClone(state.editingProgram.workouts));
            }
            delete state.editingProgram.workouts;
        }
    } else {
        title.textContent = 'Create Program';
        state.editingProgram = {
            id: null,
            name: '',
            weeks: 4,
            schedule: [[], [], [], []]
        };
    }

    document.getElementById('programNameInput').value = state.editingProgram.name;
    document.getElementById('programWeeksInput').value = state.editingProgram.weeks;
    renderProgramBuilderWeekTabs();
    renderProgramBuilderWorkouts();
}

window.updateProgramWeeks = function(val) {
    // Truncate before parsing
    const safeVal = String(val).substring(0, 4);
    const newWeeks = parseInt(safeVal);
    if (isNaN(newWeeks) || newWeeks < 1) return;
    
    state.editingProgram.weeks = newWeeks;
    
    // Expand schedule array by copying the last week forward
    while (state.editingProgram.schedule.length < newWeeks) {
        const lastWeek = state.editingProgram.schedule[state.editingProgram.schedule.length - 1] || [];
        state.editingProgram.schedule.push(deepClone(lastWeek));
    }
    
    // Trim array if duration is reduced
    if (state.editingProgram.schedule.length > newWeeks) {
        state.editingProgram.schedule.length = newWeeks;
        if (state.editingProgramWeek >= newWeeks) {
            state.editingProgramWeek = newWeeks - 1;
        }
    }
    
    renderProgramBuilderWeekTabs();
    renderProgramBuilderWorkouts();
};

function renderProgramBuilderWeekTabs() {
    const container = document.getElementById('programBuilderWeekTabs');
    const toolbar = document.getElementById('weekToolbar');
    const label = document.getElementById('currentWeekLabel');
    
    if (toolbar) toolbar.style.display = 'flex';
    if (label) label.textContent = `WEEK ${state.editingProgramWeek + 1}`;

    if (!container) return;
    container.innerHTML = '';
    
    if (state.editingProgram.weeks <= 1) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'grid';
    
    for (let i = 0; i < state.editingProgram.weeks; i++) {
        const btn = document.createElement('button');
        btn.className = `week-tab-btn ${i === state.editingProgramWeek ? 'active' : ''}`;
        btn.textContent = `Week ${i + 1}`;
        btn.onclick = (e) => {
            e.preventDefault();
            state.editingProgramWeek = i;
            renderProgramBuilderWeekTabs();
            renderProgramBuilderWorkouts();
        };
        container.appendChild(btn);
    }
}

window.copyWeekToFuture = function() {
    if (state.editingProgram.weeks <= 1 || state.editingProgramWeek === state.editingProgram.weeks - 1) {
        alert("This is the last week. Use 'Duplicate' to add more weeks.");
        return;
    }
    if (confirm("Overwrite all following weeks with this week's workouts?")) {
        const currentWeekData = state.editingProgram.schedule[state.editingProgramWeek];
        for (let i = state.editingProgramWeek + 1; i < state.editingProgram.weeks; i++) {
            state.editingProgram.schedule[i] = deepClone(currentWeekData);
        }
        alert("Copied successfully!");
    }
};

window.duplicateCurrentWeek = function() {
    const currentWeekData = deepClone(state.editingProgram.schedule[state.editingProgramWeek]);
    state.editingProgram.schedule.splice(state.editingProgramWeek + 1, 0, currentWeekData);
    state.editingProgram.weeks++;
    state.editingProgramWeek++; // switch to the new week
    
    const weeksInput = document.getElementById('programWeeksInput');
    if (weeksInput) weeksInput.value = state.editingProgram.weeks;
    
    renderProgramBuilderWeekTabs();
    renderProgramBuilderWorkouts();
};

window.deleteCurrentWeek = function() {
    if (state.editingProgram.weeks <= 1) {
        alert("Cannot delete the only week in the program.");
        return;
    }
    if (confirm(`Are you sure you want to delete Week ${state.editingProgramWeek + 1}?`)) {
        state.editingProgram.schedule.splice(state.editingProgramWeek, 1);
        state.editingProgram.weeks--;
        
        if (state.editingProgramWeek >= state.editingProgram.weeks) {
            state.editingProgramWeek = state.editingProgram.weeks - 1;
        }
        
        const weeksInput = document.getElementById('programWeeksInput');
        if (weeksInput) weeksInput.value = state.editingProgram.weeks;
        
        renderProgramBuilderWeekTabs();
        renderProgramBuilderWorkouts();
    }
};

window.addRestDayToProgram = function() {
    state.editingProgram.schedule[state.editingProgramWeek].push({
        isRestDay: true,
        name: 'Rest Day',
        exercises: []
    });
    renderProgramBuilderWorkouts();
};

function renderProgramBuilderWorkouts() {
    const builder = document.getElementById('workoutBuilder');
    builder.innerHTML = '';
    
    const currentWeekWorkouts = state.editingProgram.schedule[state.editingProgramWeek];

    if (!currentWeekWorkouts || currentWeekWorkouts.length === 0) {
        builder.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">

                <p style="margin:0; font-weight:600;">No workouts in Week ${state.editingProgramWeek + 1}</p>
                <p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Build your routine by adding workout days below.</p>
            </div>`;
        return;
    }

    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));
    const fragment = document.createDocumentFragment();

    currentWeekWorkouts.forEach((workout, i) => {
        const card = document.createElement('div');
        card.className = 'program-builder-card draggable-item';
        card.dataset.index = i;

        if (workout.isRestDay) {
            card.style.borderStyle = 'dashed';
            card.innerHTML = `
                <div class="program-builder-card-header">
                    <div class="flex items-center gap-2">
                        <span class="drag-handle" title="Drag to reorder">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                        </span>
                        <div class="flex flex-col">
                            <span class="text-xs text-secondary font-bold uppercase tracking-wide">Day ${i + 1}</span>
                            <span class="font-bold text-md text-secondary flex items-center gap-2 mt-1">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                                Rest Day
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="btn-icon-xs" title="Duplicate" onclick="event.preventDefault(); duplicateWorkoutInProgram(${i})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="btn-icon-xs btn-transparent-danger" title="Delete" onclick="event.preventDefault(); removeWorkoutFromProgram(${i})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>
            `;
            fragment.appendChild(card);
            return;
        }

        // Header section
        const header = document.createElement('div');
        header.className = 'program-builder-card-header';
        
        const titleGroup = document.createElement('div');
        titleGroup.className = 'flex items-center gap-2';
        titleGroup.innerHTML = `
            <span class="drag-handle" title="Drag to reorder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
            </span>
            <div class="flex flex-col">
                <span class="text-xs text-primary font-bold uppercase tracking-wide">Day ${i + 1}</span>
                <span class="font-bold text-md">${escapeHtml(workout.name)}</span>
            </div>
        `;

        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'flex items-center gap-1';
        actionsGroup.innerHTML = `
            <button class="btn-icon-xs" title="Duplicate Workout" onclick="event.preventDefault(); duplicateWorkoutInProgram(${i})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button class="btn-icon-xs" title="Edit Workout" onclick="event.preventDefault(); openWorkoutBuilder(null, ${i}, 'program')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon-xs btn-transparent-danger" title="Delete Workout" onclick="event.preventDefault(); removeWorkoutFromProgram(${i})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;

        header.appendChild(titleGroup);
        header.appendChild(actionsGroup);
        card.appendChild(header);

        // Body section (Tags)
        const body = document.createElement('div');
        body.className = 'program-builder-card-body mt-2';
        
        if (workout.exercises.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'flex flex-col gap-1 mt-3';
            
            workout.exercises.forEach(ex => {
                const exData = exercisesMap.get(ex.exerciseId);
                const tag = document.createElement('div');
                tag.className = 'exercise-mini-tag';
                const setTotal = ex.sets ? ex.sets.length : 0;
                tag.innerHTML = `<span class="truncate">${exData ? escapeHtml(exData.name) : 'Unknown'}</span> <span class="tag-sets">${setTotal} ${setTotal === 1 ? 'set' : 'sets'}</span>`;
                tagsContainer.appendChild(tag);
            });
            body.appendChild(tagsContainer);
        } else {
            body.innerHTML = '<div class="text-xs text-secondary italic mt-2 mb-2">No exercises. Click Edit to add.</div>';
        }

        // Stats section
        const stats = document.createElement('div');
        stats.className = 'flex justify-between items-center mt-3 pt-2 border-t text-xs text-secondary font-medium';
        const totalSets = workout.exercises.reduce((acc, ex) => acc + (ex.sets ? ex.sets.length : 0), 0);
        stats.innerHTML = `<span>${workout.exercises.length} Exercises</span><span>${totalSets} Sets Total</span>`;
        body.appendChild(stats);

        card.appendChild(body);
        fragment.appendChild(card);
    });

    builder.appendChild(fragment);
    initDragToReorder('workoutBuilder', 'editingProgram');
}

function closeProgramBuilder() {
    setModalClose('programBuilderModal');
    state.editingProgram = null;
}

function addWorkoutToProgram() {
    openWorkoutBuilder(null, null, 'program');
}

window.advanceWeek = function() {
    const program = state.programs.find(p => p.id === state.currentProgram);
    if (!program) return;
    if (state.currentWeek < program.weeks) {
        state.currentWeek++;
        saveState();
        renderTrainingTab();
    } else {
        if (confirm("You have completed all " + program.weeks + " weeks! Mark program as done and reset to Week 1?")) {
            state.currentWeek = 1;
            saveState();
            renderTrainingTab();
        }
    }
};

window.retreatWeek = function() {
    if (state.currentWeek > 1) {
        state.currentWeek--;
        saveState();
        renderTrainingTab();
    }
};

window.removeWorkoutFromProgram = function(index) {
    state.editingProgram.schedule[state.editingProgramWeek].splice(index, 1);
    renderProgramBuilderWorkouts();
};

window.duplicateWorkoutInProgram = function(index) {
    const workoutToCopy = state.editingProgram.schedule[state.editingProgramWeek][index];
    const copy = deepClone(workoutToCopy);
    // Secure string lengths even on copies to prevent runaway dupes
    copy.name = String(copy.name + " (Copy)").substring(0, 100);
    // Insert immediately after the original
    state.editingProgram.schedule[state.editingProgramWeek].splice(index + 1, 0, copy);
    renderProgramBuilderWorkouts();
};

function saveProgram() {
    const name = document.getElementById('programNameInput').value.trim().substring(0, 100);
    const weeksStr = document.getElementById('programWeeksInput').value;
    const weeks = parseInt(weeksStr);

    if (!name) {
        alert('Please enter a program name');
        return;
    }
    
    if (isNaN(weeks) || weeks < 1) {
        alert('Please enter a valid number of weeks');
        return;
    }

    const hasWorkouts = state.editingProgram.schedule.some(weekSchedule => weekSchedule.length > 0);
    if (!hasWorkouts) {
        alert('Please add at least one workout day to your program before saving.');
        return;
    }

    state.editingProgram.name = name;
    state.editingProgram.weeks = weeks;

    if (state.editingProgram.id) {
        const index = state.programs.findIndex(p => p.id === state.editingProgram.id);
        state.programs[index] = state.editingProgram;
    } else {
        state.editingProgram.id = Date.now();
        state.programs.push(state.editingProgram);
    }

    saveState();
    closeProgramBuilder();
    renderProgramsList();
}

// --- Workout Builder Logic (Program & Standalone) ---
window.openWorkoutBuilder = function(workoutToEdit = null, workoutIndex = null, context = 'program') {
    setModalOpen('workoutBuilderModal');
    state.workoutBuilderContext = context;

    if (context === 'program') {
        if (workoutIndex !== null) {
            state.editingWorkout = deepClone(state.editingProgram.schedule[state.editingProgramWeek][workoutIndex]);
            state.editingWorkout.index = workoutIndex;
        } else {
            state.editingWorkout = {
                name: '',
                exercises: []
            };
        }
    } else if (context === 'standalone') {
        if (workoutToEdit) {
            state.editingWorkout = deepClone(workoutToEdit);
        } else {
            state.editingWorkout = {
                id: Date.now(),
                name: '',
                exercises: []
            };
        }
    }

    document.getElementById('workoutNameInput').value = state.editingWorkout.name;
    renderWorkoutBuilderExercises();
};

// --- SortableJS Drag to Reorder ---
let sortableInstances = {}; // Manage global drag instances safely

function initDragToReorder(containerId, stateKey) {
    if (typeof Sortable === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    // VERY IMPORTANT: Destroy any existing instance on this container before making a new one
    if (sortableInstances[containerId]) {
        sortableInstances[containerId].destroy();
    }

    sortableInstances[containerId] = new Sortable(container, {
        handle: '.drag-handle',
        animation: 150, 
        ghostClass: 'drag-target', 
        onEnd: function (evt) {
            const fromIndex = evt.oldIndex;
            const toIndex = evt.newIndex;
            
            if (fromIndex === toIndex) return;

            // Manipulate state array to perfectly match visually swapped items
            if (stateKey === 'editingWorkout') {
                const arr = state.editingWorkout.exercises;
                const [moved] = arr.splice(fromIndex, 1);
                arr.splice(toIndex, 0, moved);
                renderWorkoutBuilderExercises();
            } else if (stateKey === 'editingProgram') {
                const arr = state.editingProgram.schedule[state.editingProgramWeek];
                const [moved] = arr.splice(fromIndex, 1);
                arr.splice(toIndex, 0, moved);
                renderProgramBuilderWorkouts();
            }
        }
    });
}

window.updateBuilderExerciseRest = function(exIndex, value) {
    state.editingWorkout.exercises[exIndex].restTime = parseInt(String(value).substring(0, 4)) || 0;
};

function renderWorkoutBuilderExercises() {
    const builder = document.getElementById('exerciseBuilder');
    builder.innerHTML = '';
    
    if (state.editingWorkout.exercises.length === 0) {
        builder.innerHTML = '<div class="empty-state">No exercises added yet.</div>';
        return;
    }

    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));
    const fragment = document.createDocumentFragment();

    state.editingWorkout.exercises.forEach((ex, i) => {
        const exerciseData = exercisesMap.get(ex.exerciseId);
        const item = document.createElement('div');
        item.className = 'builder-item draggable-item';
        item.dataset.index = i;
        
        const currentRestTime = ex.restTime !== undefined ? ex.restTime : (exerciseData ? exerciseData.restTime : 90);

        let setsHTML = `<div class="mt-4">`;
        
        setsHTML += `
            <div class="flex items-center justify-between mb-3 pb-2 border-b">
                <span class="text-xs text-secondary font-medium uppercase tracking-wide">Workout Rest Timer</span>
                <div class="flex items-center gap-1">
                    <input type="text" inputmode="numeric" class="input-field text-center p-1" style="width: 50px; min-height: 0; font-size: 13px;" value="${currentRestTime}" oninput="enforceNumeric(this, false); updateBuilderExerciseRest(${i}, this.value)">
                    <span class="text-xs text-secondary">sec</span>
                </div>
            </div>
        `;

        setsHTML += `
            <div class="flex justify-between text-xs text-secondary font-bold uppercase mb-2 px-1">
                <span class="w-12 text-center">Set</span>
                <span class="flex-grow text-center">Target Reps</span>
                <span class="w-8"></span>
            </div>
        `;

        if (ex.sets && ex.sets.length > 0) {
            ex.sets.forEach((set, setIndex) => {
                setsHTML += `
                    <div class="flex items-center gap-2 mb-2">
                        <span class="w-12 text-center text-sm font-bold text-secondary">${setIndex + 1}</span>
                        <input type="text" class="input-field py-2 px-3 flex-grow text-center font-bold" style="min-height: 40px; border-radius: 8px;" placeholder="e.g. 8-12" value="${set.reps !== undefined ? escapeHtml(String(set.reps)) : ''}" oninput="enforceRepRange(this); updateBuilderSet(${i}, ${setIndex}, 'reps', this.value)">
                        <button class="btn-icon-xs btn-transparent-danger w-8 h-8 flex-shrink-0" title="Remove Set" onclick="removeBuilderSet(${i}, ${setIndex})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
            });
        }
        setsHTML += `<button class="btn-dashed btn-sm w-full mt-2" onclick="addBuilderSet(${i})">+ Add Set</button></div>`;

        item.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-2">
                    <span class="drag-handle" title="Drag to reorder">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                    </span>
                    <strong class="text-md">${exerciseData ? escapeHtml(exerciseData.name) : 'Unknown'}</strong>
                </div>
                <div class="flex gap-1">
                    <button class="btn-icon-xs" title="Duplicate Exercise" onclick="duplicateExerciseInBuilder(${i})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="btn-icon-xs btn-transparent-danger" title="Remove Exercise" onclick="removeExerciseFromBuilder(${i})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            ${setsHTML}
        `;
        fragment.appendChild(item);
    });

    builder.appendChild(fragment);
    initDragToReorder('exerciseBuilder', 'editingWorkout');
}

window.updateBuilderSet = function(exIndex, setIndex, field, value) {
    if (typeof value === 'string' && field === 'reps') value = value.substring(0, 15);
    state.editingWorkout.exercises[exIndex].sets[setIndex][field] = value;
};

window.removeBuilderSet = function(exIndex, setIndex) {
    state.editingWorkout.exercises[exIndex].sets.splice(setIndex, 1);
    renderWorkoutBuilderExercises();
};

window.addBuilderSet = function(exIndex) {
    const ex = state.editingWorkout.exercises[exIndex];
    const lastSet = ex.sets[ex.sets.length - 1];
    ex.sets.push({
        reps: lastSet && lastSet.reps !== undefined ? lastSet.reps : ''
    });
    renderWorkoutBuilderExercises();
};

window.removeExerciseFromBuilder = function(index) {
    state.editingWorkout.exercises.splice(index, 1);
    renderWorkoutBuilderExercises();
};

window.duplicateExerciseInBuilder = function(index) {
    const exToCopy = state.editingWorkout.exercises[index];
    const copy = deepClone(exToCopy);
    state.editingWorkout.exercises.splice(index + 1, 0, copy);
    renderWorkoutBuilderExercises();
};

function closeWorkoutBuilder() {
    setModalClose('workoutBuilderModal');
    state.editingWorkout = null;
    state.workoutBuilderContext = null;
}

function saveWorkout() {
    const name = document.getElementById('workoutNameInput').value.trim().substring(0, 100);
    if (!name) return alert("Workout name required");

    // Validate no exercises with 0 sets
    const emptyExercises = state.editingWorkout.exercises.filter(ex => !ex.sets || ex.sets.length === 0);
    if (emptyExercises.length > 0) {
        const names = emptyExercises.map(ex => {
            const d = state.exercises.find(e => e.id === ex.exerciseId);
            return d ? d.name : 'Unknown';
        }).join(', ');
        return alert(`These exercises have no sets: ${names}. Add at least 1 set or remove them.`);
    }

    state.editingWorkout.name = name;

    if (state.workoutBuilderContext === 'program') {
        if (state.editingWorkout.index !== undefined && state.editingWorkout.index !== null) {
            state.editingProgram.schedule[state.editingProgramWeek][state.editingWorkout.index] = state.editingWorkout;
        } else {
            state.editingProgram.schedule[state.editingProgramWeek].push(state.editingWorkout);
        }
        renderProgramBuilderWorkouts();
    } else if (state.workoutBuilderContext === 'standalone') {
        const existingIndex = state.standaloneWorkouts.findIndex(w => w.id === state.editingWorkout.id);
        if (existingIndex >= 0) {
            state.standaloneWorkouts[existingIndex] = state.editingWorkout;
        } else {
            state.standaloneWorkouts.push(state.editingWorkout);
        }
        saveState();
        renderStandaloneWorkoutsList();
        renderTrainingTab();
    }

    closeWorkoutBuilder();
}

// --- Exercise Selection Logic (Multi-Select) ---
function openExerciseSelection(source) {
    state.exerciseSelectionSource = source;
    selectedExercisesForBuilder.clear();
    renderExerciseSelection();
    updateExerciseSelectionFooter();
    setModalOpen('exerciseSelectionModal');
}

function closeExerciseSelection() {
    setModalClose('exerciseSelectionModal');
    state.exerciseSelectionSource = null;
}

window.toggleExerciseSelection = function(exerciseId) {
    if (selectedExercisesForBuilder.has(exerciseId)) {
        selectedExercisesForBuilder.delete(exerciseId);
    } else {
        selectedExercisesForBuilder.add(exerciseId);
    }
    const filter = document.getElementById('exerciseSelectionSearch').value;
    renderExerciseSelection(filter);
    updateExerciseSelectionFooter();
};

function updateExerciseSelectionFooter() {
    const btn = document.getElementById('confirmExerciseSelectionBtn');
    if (btn) {
        const count = selectedExercisesForBuilder.size;
        btn.textContent = `Add Exercises (${count})`;
        btn.disabled = count === 0;
    }
}

function confirmExerciseSelection() {
    const source = state.exerciseSelectionSource;
    selectedExercisesForBuilder.forEach(exId => {
        const exercise = state.exercises.find(e => e.id === exId);
        if (!exercise) return;

        if (source === 'workoutBuilder') {
            state.editingWorkout.exercises.push({
                exerciseId: exercise.id,
                restTime: exercise.restTime || 90,
                sets: [{ reps: '' }] // Start with one empty set
            });
        } else if (source === 'activeWorkout') {
            const autofill = getAutoFillForExercise(exercise.id, 0);
            state.activeWorkout.exercises.push({
                exerciseId: exercise.id,
                restTime: exercise.restTime || 90,
                sets: [{ 
                    weight: autofill && autofill.weight ? autofill.weight : '', 
                    reps: autofill && autofill.reps ? autofill.reps : '', 
                    targetReps: '', 
                    note: '', 
                    completed: false 
                }]
            });
        }
    });

    if (source === 'workoutBuilder') {
        renderWorkoutBuilderExercises();
    } else if (source === 'activeWorkout') {
        saveState();
        renderActiveExercises();
    }

    closeExerciseSelection();
}

function renderExerciseSelection(filter = '') {
    const list = document.getElementById('exerciseSelectionList');
    list.innerHTML = '';

    const filtered = state.exercises.filter(e =>
        e.name.toLowerCase().includes(filter.toLowerCase())
    );

    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'other';
        const cat = rawCat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
    });

    const sortedCategories = Object.keys(categories).sort();

    sortedCategories.forEach(cat => {
        const exercises = categories[cat];

        const catHeader = document.createElement('div');
        catHeader.className = 'section-title-sm';
        catHeader.textContent = cat;
        list.appendChild(catHeader);

        exercises.forEach(exercise => {
            const isSelected = selectedExercisesForBuilder.has(exercise.id);
            const item = document.createElement('div');
            item.className = `builder-item clickable flex justify-between items-center ${isSelected ? 'selected-exercise' : ''}`;
            
            item.innerHTML = `
                <div class="flex flex-col">
                    <h4 class="text-md ${isSelected ? 'text-primary' : ''}">${escapeHtml(exercise.name)}</h4>
                </div>
                <div class="selection-indicator">
                    ${isSelected ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<div class="empty-circle"></div>'}
                </div>
            `;
            item.addEventListener('click', () => toggleExerciseSelection(exercise.id));
            list.appendChild(item);
        });
    });
}

function filterExerciseSelection(e) {
    renderExerciseSelection(e.target.value);
}

// --- Library & Generic Logic ---
function renderProgramsList() {
    const list = document.getElementById('programsList');
    list.innerHTML = '';

    if (state.programs.length === 0) {
        list.innerHTML = '<div class="empty-state">No programs created yet.</div>';
        return;
    }

    state.programs.forEach(program => {
        const details = document.createElement('details');
        details.className = 'category-group';
        details.open = false;
        
        const isActive = state.currentProgram === program.id;
        const week1Workouts = program.schedule && program.schedule[0] ? program.schedule[0] : [];

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <div class="flex flex-grow justify-between items-center w-full">
                <div>
                    <div class="flex items-center gap-2">
                        <h3 class="mb-0">${escapeHtml(program.name)}</h3>
                        ${isActive ? '<span class="badge badge-primary">Active</span>' : ''}
                    </div>
                    <span class="text-secondary text-sm">${program.weeks} weeks • ${week1Workouts.length} workouts/wk</span>
                </div>
                <div class="flex items-center gap-2">
                    ${!isActive ? `<button class="btn-primary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); selectProgram(${program.id})">Select</button>` : ''}
                    <button class="btn-secondary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); editProgram(${program.id})">Edit</button>
                    <button class="btn-text-danger btn-sm" onclick="event.preventDefault(); event.stopPropagation(); deleteProgram(${program.id})">Del</button>
                </div>
            </div>
        `;

        const content = document.createElement('div');
        content.className = 'category-content';

        if (program.weeks > 1) {
            content.innerHTML += `<div class="text-xs text-secondary mb-2 uppercase tracking-wide font-bold">Week 1 Schedule</div>`;
        }

        if (week1Workouts.length === 0) {
            content.innerHTML += '<div class="text-center text-sm text-secondary py-2">No workouts in Week 1.</div>';
        } else {
            week1Workouts.forEach((workout, i) => {
                if (workout.isRestDay) {
                    const row = document.createElement('div');
                    row.className = 'exercise-item-row';
                    row.innerHTML = `<span class="font-medium text-secondary italic flex items-center gap-2"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg> Rest Day</span>`;
                    content.appendChild(row);
                } else {
                    const row = document.createElement('div');
                    row.className = 'exercise-item-row';
                    row.innerHTML = `<span class="font-medium">${escapeHtml(workout.name)}</span>`;
                    content.appendChild(row);
                }
            });
        }

        details.appendChild(summary);
        details.appendChild(content);
        list.appendChild(details);
    });
}

function renderStandaloneWorkoutsList() {
    const list = document.getElementById('standaloneList');
    if (!list) return;
    list.innerHTML = '';

    if (!state.standaloneWorkouts || state.standaloneWorkouts.length === 0) {
        list.innerHTML = '<div class="empty-state">No standalone workouts created yet.</div>';
        return;
    }

    state.standaloneWorkouts.forEach(workout => {
        const card = document.createElement('div');
        card.className = 'card';

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="mb-2">${escapeHtml(workout.name)}</h3>
                    <p class="text-secondary text-sm mb-4">${workout.exercises.length} exercises</p>
                </div>
            </div>
            <div class="flex gap-2 flex-wrap">
                <button class="btn-secondary btn-sm" onclick="startStandaloneWorkout(${workout.id})">Start</button>
                <button class="btn-secondary btn-sm" onclick="editStandaloneWorkout(${workout.id})">Edit</button>
                <button class="btn-text-danger btn-sm ml-auto" onclick="deleteStandaloneWorkout(${workout.id})">Delete</button>
            </div>
        `;
        list.appendChild(card);
    });
}

window.editStandaloneWorkout = function(id) {
    const workout = state.standaloneWorkouts.find(w => w.id === id);
    if (workout) openWorkoutBuilder(workout, null, 'standalone');
}

window.deleteStandaloneWorkout = function(id) {
    if (confirm('Delete this standalone workout?')) {
        state.standaloneWorkouts = state.standaloneWorkouts.filter(w => w.id !== id);
        saveState();
        renderStandaloneWorkoutsList();
        renderTrainingTab();
    }
}

window.selectProgram = function(id) {
    state.currentProgram = id;
    state.currentWeek = 1;
    saveState();
    renderTrainingTab();
    renderProgramsList();
    document.querySelector('.tab-btn[data-tab="training"]').click();
};

window.editProgram = function(id) {
    const program = state.programs.find(p => p.id === id);
    if (program) openProgramBuilder(program);
};

window.deleteProgram = function(id) {
    if (confirm('Delete this program?')) {
        state.programs = state.programs.filter(p => p.id !== id);
        if (state.currentProgram === id) state.currentProgram = null;
        saveState();
        renderProgramsList();
        renderTrainingTab();
    }
};

function renderExercisesList(filter = '') {
    const list = document.getElementById('exercisesList');
    list.innerHTML = '';

    const filtered = state.exercises.filter(e =>
        e.name.toLowerCase().includes(filter.toLowerCase())
    );

    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'other';
        const cat = rawCat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
    });

    const sortedCategories = Object.keys(categories).sort();

    if (sortedCategories.length === 0) {
        list.innerHTML = '<div class="empty-state">No exercises found.</div>';
        return;
    }

    sortedCategories.forEach(cat => {
        const exercises = categories[cat];

        const details = document.createElement('details');
        details.className = 'category-group';
        details.open = true;

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <span class="font-bold text-primary">${cat}</span>
            <span class="text-secondary text-sm ml-auto">${exercises.length}</span>
        `;
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'category-content';

        exercises.forEach(exercise => {
            const card = document.createElement('div');
            card.className = 'exercise-item-row';
            card.innerHTML = `
                <h4>${escapeHtml(exercise.name)}</h4>
                <div class="flex gap-2">
                    <button class="btn-icon-xs" onclick="editExercise(${exercise.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-xs btn-transparent-danger" onclick="deleteExercise(${exercise.id})">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;
            content.appendChild(card);
        });

        details.appendChild(content);
        list.appendChild(details);
    });
}

function filterExercises(e) {
    renderExercisesList(e.target.value);
}

window.deleteExercise = function(id) {
    if (confirm('Delete this exercise?')) {
        state.exercises = state.exercises.filter(e => e.id !== id);
        saveState();
        renderExercisesList();
    }
};

window.editExercise = function(id) {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return;
    
    state.editingExerciseId = id;
    
    document.getElementById('addExerciseModalTitle').textContent = 'Edit Exercise';
    document.getElementById('exerciseNameInput').value = ex.name;
    document.getElementById('exerciseCategoryInput').value = ex.category || 'other';
    document.getElementById('exerciseRestInput').value = ex.restTime || 90;
    
    setModalOpen('addExerciseModal');
};

function openAddExercise() {
    state.editingExerciseId = null;
    document.getElementById('addExerciseModalTitle').textContent = 'New Exercise';
    const input = document.getElementById('exerciseNameInput');
    input.value = '';
    document.getElementById('exerciseCategoryInput').value = 'other';
    document.getElementById('exerciseRestInput').value = 90;
    setModalOpen('addExerciseModal');
    input.focus();
}

function closeAddExercise() {
    setModalClose('addExerciseModal');
    state.editingExerciseId = null;
}

function saveExercise() {
    const name = document.getElementById('exerciseNameInput').value.trim().substring(0, 100);
    const category = document.getElementById('exerciseCategoryInput').value.trim().substring(0, 50);
    const restTimeEl = document.getElementById('exerciseRestInput');
    const restTime = restTimeEl ? parseInt(String(restTimeEl.value).substring(0, 4)) || 90 : 90;

    if (!name) {
        alert('Name required');
        return;
    }

    if (state.editingExerciseId) {
        const exIndex = state.exercises.findIndex(e => e.id === state.editingExerciseId);
        if (exIndex > -1) {
            state.exercises[exIndex].name = name;
            state.exercises[exIndex].category = category;
            state.exercises[exIndex].restTime = restTime;
        }
    } else {
        state.exercises.push({
            id: Date.now(),
            name,
            category,
            restTime
        });
    }
    
    // Ensure exercises are always inserted alphabetically
    state.exercises.sort((a, b) => a.name.localeCompare(b.name));
    
    saveState();
    closeAddExercise();
    renderExercisesList();
}

// --- Settings Preferences ---
function renderSettingsPreferences() {
    const unit = state.weightUnit || 'lbs';
    const lbsBtn = document.getElementById('unitLbs');
    const kgBtn = document.getElementById('unitKg');
    if (lbsBtn) lbsBtn.classList.toggle('active', unit === 'lbs');
    if (kgBtn) kgBtn.classList.toggle('active', unit === 'kg');
}