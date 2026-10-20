import { auth, app, currentUser, safeNext } from "./auth.js";
import {
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signInWithPopup,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const form = document.getElementById("auth-form");
const msg = document.getElementById("auth-msg");
const submitBtn = document.getElementById("submit-btn");
const googleBtn = document.getElementById("google-btn");
const title = document.getElementById("auth-title");
const sub = document.getElementById("auth-sub");
const password = document.getElementById("password");

let mode = "signin";

const ERRORS = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found with this email.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a minute and try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/unauthorized-domain": "This website's domain is not authorised in Firebase yet.",
};

function show(text, kind = "error") {
    msg.textContent = text;
    msg.className = "alert " + (kind === "ok" ? "alert-ok" : "alert-error");
    msg.hidden = false;
}

function busy(button, on, label) {
    button.disabled = on;
    if (on) {
        button.dataset.label = button.innerHTML;
        button.innerHTML = '<span class="spinner"></span> ' + label;
    } else if (button.dataset.label) {
        button.innerHTML = button.dataset.label;
    }
}

function done() {
    location.replace(safeNext());
}

function setMode(next) {
    mode = next;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    document.querySelectorAll("[data-signup]").forEach((el) => (el.hidden = mode !== "signup"));
    document.querySelectorAll("[data-signin]").forEach((el) => (el.hidden = mode !== "signin"));
    title.textContent = mode === "signin" ? "Welcome back" : "Create your account";
    sub.textContent = mode === "signin" ? "Sign in to analyse your dental X-rays." : "It only takes a few seconds.";
    submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account";
    password.autocomplete = mode === "signin" ? "current-password" : "new-password";
    msg.hidden = true;
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

// Already signed in? Skip the form entirely.
currentUser().then((user) => {
    if (user) done();
});

async function saveProfile(user, name, phone) {
    // Firestore is only needed at sign-up, so load it lazily.
    try {
        const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await setDoc(doc(getFirestore(app), "Users", user.email), { UserName: name, Email: user.email, Phone: phone }, { merge: true });
    } catch (err) {
        console.warn("Could not save profile to Firestore:", err);
    }
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.hidden = true;

    const email = form.email.value.trim();
    const pass = form.password.value;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();

    if (!email || !pass) return show("Please enter your email and password.");
    if (mode === "signup") {
        if (!name) return show("Please enter your name.");
        if (pass.length < 8) return show("Password must be at least 8 characters.");
        if (phone && !/^[6-9]\d{9}$/.test(phone)) return show("Phone must be a 10-digit mobile number.");
    }

    busy(submitBtn, true, mode === "signin" ? "Signing in…" : "Creating account…");
    try {
        if (mode === "signin") {
            await signInWithEmailAndPassword(auth, email, pass);
        } else {
            const { user } = await createUserWithEmailAndPassword(auth, email, pass);
            await Promise.all([updateProfile(user, { displayName: name }), saveProfile(user, name, phone)]);
        }
        done();
    } catch (err) {
        busy(submitBtn, false);
        show(ERRORS[err.code] || err.message);
    }
});

googleBtn.addEventListener("click", async () => {
    msg.hidden = true;
    busy(googleBtn, true, "Opening Google…");
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        done();
    } catch (err) {
        busy(googleBtn, false);
        show(ERRORS[err.code] || err.message);
    }
});

document.getElementById("forgot-btn").addEventListener("click", async () => {
    const email = form.email.value.trim();
    if (!email) return show("Enter your email above, then click “Forgot password?” again.");
    try {
        await sendPasswordResetEmail(auth, email);
        show("Password reset email sent to " + email + ".", "ok");
    } catch (err) {
        show(ERRORS[err.code] || err.message);
    }
});
