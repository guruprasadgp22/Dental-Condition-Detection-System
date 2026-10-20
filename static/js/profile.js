import { app, auth, currentUser } from "./auth.js";
import {
    sendEmailVerification,
    sendPasswordResetEmail,
    signOut,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Loaded on demand so account details still show if Firestore is unavailable.
let firestore = null;
async function store() {
    if (!firestore) {
        const fs = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        firestore = { ...fs, db: fs.getFirestore(app) };
    }
    return firestore;
}
const $ = (id) => document.getElementById(id);

const FIELDS = {
    UserName: "f-name",
    Phone: "f-phone",
    DateOfBirth: "f-dob",
    Gender: "f-gender",
    City: "f-city",
    Dentist: "f-dentist",
};

let user = null;
let saved = {};

function message(el, text, kind = "ok") {
    el.textContent = text;
    el.className = "alert " + (kind === "ok" ? "alert-ok" : "alert-error");
    el.hidden = false;
}

function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function providerName(u) {
    const id = u.providerData[0]?.providerId;
    return id === "google.com" ? "Google account" : id === "password" ? "Email account" : "Account";
}

function renderHeader() {
    const name = saved.UserName || user.displayName || "Your profile";
    $("p-name").textContent = name;
    $("p-email").textContent = user.email || "";

    const avatar = $("p-avatar");
    avatar.replaceChildren();
    if (user.photoURL) {
        const img = document.createElement("img");
        img.src = user.photoURL;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        avatar.appendChild(img);
    } else {
        avatar.textContent = name.trim().charAt(0).toUpperCase() || "?";
    }

    $("p-provider").textContent = providerName(user);
    const verified = $("p-verified");
    verified.hidden = false;
    verified.textContent = user.emailVerified ? "Verified" : "Not verified";
    verified.className = "badge " + (user.emailVerified ? "verified" : "moderate");

    $("p-created").textContent = formatDate(user.metadata.creationTime);
    $("p-last").textContent = formatDate(user.metadata.lastSignInTime);
}

function fillForm() {
    $("f-email").value = user.email || "";
    Object.entries(FIELDS).forEach(([key, id]) => {
        $(id).value = saved[key] || (key === "UserName" ? user.displayName || "" : "");
    });
}

function renderHistory() {
    let items = [];
    try {
        items = JSON.parse(localStorage.getItem("dentes.history")) || [];
    } catch {
        /* storage unavailable */
    }
    items = items.filter((i) => Date.now() - i.at < 24 * 3600 * 1000);
    $("p-scans").textContent = items.length;

    const list = $("p-history");
    list.replaceChildren();
    items.forEach((i) => {
        const a = document.createElement("a");
        a.href = "/report/" + i.id;
        a.target = "_blank";
        a.rel = "noopener";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = i.name + " · " + i.total + " finding" + (i.total === 1 ? "" : "s");
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = new Date(i.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        a.append(name, when);
        const li = document.createElement("li");
        li.appendChild(a);
        list.appendChild(li);
    });
    $("p-history-empty").hidden = items.length > 0;
}

async function load() {
    user = await currentUser();
    if (!user) return; // auth.js redirects to /login

    renderHeader();
    fillForm();
    renderHistory();

    const isPassword = user.providerData.some((p) => p.providerId === "password");
    $("verify-row").hidden = !isPassword || user.emailVerified;
    if (!isPassword) {
        $("pw-hint").textContent = "You sign in with Google, so your password is managed by your Google account.";
        $("pw-btn").hidden = true;
    }

    try {
        const { doc, getDoc, db } = await store();
        const snap = await getDoc(doc(db, "Users", user.email));
        if (snap.exists()) {
            saved = snap.data();
            renderHeader();
            fillForm();
        }
    } catch (err) {
        console.warn("Could not load profile:", err);
        message($("profile-msg"), "Could not load your saved details. Check the Firestore security rules.", "error");
    }
}

$("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("profile-msg");
    msg.hidden = true;

    const data = { Email: user.email };
    Object.entries(FIELDS).forEach(([key, id]) => (data[key] = $(id).value.trim()));

    if (!data.UserName) return message(msg, "Please enter your name.", "error");
    if (data.Phone && !/^[6-9]\d{9}$/.test(data.Phone)) {
        return message(msg, "Phone must be a 10-digit mobile number.", "error");
    }
    if (data.DateOfBirth && new Date(data.DateOfBirth) > new Date()) {
        return message(msg, "Date of birth can't be in the future.", "error");
    }

    const btn = $("save-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
        const { doc, setDoc, db } = await store();
        await Promise.all([
            setDoc(doc(db, "Users", user.email), data, { merge: true }),
            data.UserName !== user.displayName ? updateProfile(user, { displayName: data.UserName }) : null,
        ]);
        saved = { ...saved, ...data };
        renderHeader();
        const navName = document.querySelector(".user-dropdown-head strong");
        if (navName) navName.textContent = data.UserName;
        message(msg, "Your details have been saved.");
    } catch (err) {
        message(msg, "Could not save: " + (err.code === "permission-denied" ? "permission denied by Firestore rules." : err.message), "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save changes";
    }
});

$("reset-form-btn").addEventListener("click", () => {
    fillForm();
    $("profile-msg").hidden = true;
});

$("pw-btn").addEventListener("click", async () => {
    try {
        await sendPasswordResetEmail(auth, user.email);
        message($("security-msg"), "Password reset link sent to " + user.email + ".");
    } catch (err) {
        message($("security-msg"), err.message, "error");
    }
});

$("verify-btn").addEventListener("click", async () => {
    try {
        await sendEmailVerification(user);
        message($("security-msg"), "Verification email sent. Check your inbox, then sign in again.");
    } catch (err) {
        message($("security-msg"), err.message, "error");
    }
});

$("signout-btn").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "/";
});

load();
