// Firebase auth shared by every page: one SDK version, loaded once, cached by the browser.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Injected by Flask from environment variables (.env locally), so no keys live in source code.
export const firebaseConfig = window.FIREBASE_CONFIG || {};
if (!firebaseConfig.apiKey) {
    console.error("Firebase config missing: set the FIREBASE_* variables in .env (see .env.example).");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/** Resolve once Firebase knows whether someone is signed in. */
export function currentUser() {
    return new Promise((resolve) => {
        const stop = onAuthStateChanged(auth, (user) => {
            stop();
            resolve(user);
        });
    });
}

/** Only allow same-site relative paths as a post-login redirect. */
export function safeNext(fallback = "/scan") {
    const next = new URLSearchParams(location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function initials(user) {
    const source = user.displayName || user.email || "?";
    return source.trim().charAt(0).toUpperCase();
}

/** Signed out: a "Sign in" button. Signed in: only the avatar icon, which opens a small account menu. */
export function renderNav(user) {
    const slot = document.getElementById("nav-user");
    if (!slot) return;
    slot.replaceChildren();

    if (!user) {
        const link = document.createElement("a");
        link.className = "btn btn-primary btn-sm";
        link.style.color = "#fff";
        link.href = "/login";
        link.textContent = "Sign in";
        slot.appendChild(link);
        return;
    }

    const wrap = document.createElement("div");
    wrap.className = "user-menu";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar";
    button.setAttribute("aria-label", "Account menu");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.title = user.email || "Account";
    if (user.photoURL) {
        const img = document.createElement("img");
        img.src = user.photoURL;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        button.appendChild(img);
    } else {
        button.textContent = initials(user);
    }

    const menu = document.createElement("div");
    menu.className = "user-dropdown";
    menu.hidden = true;

    const head = document.createElement("div");
    head.className = "user-dropdown-head";
    const name = document.createElement("strong");
    name.textContent = user.displayName || "Signed in";
    const email = document.createElement("span");
    email.textContent = user.email || "";
    head.append(name, email);

    const profile = document.createElement("a");
    profile.href = "/profile";
    profile.textContent = "My profile";

    const out = document.createElement("button");
    out.type = "button";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
        await signOut(auth);
        location.href = "/";
    });

    menu.append(head, profile, out);
    wrap.append(button, menu);
    slot.appendChild(wrap);

    const setOpen = (open) => {
        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", (e) => {
        e.stopPropagation();
        setOpen(menu.hidden);
    });
    document.addEventListener("click", (e) => {
        if (!wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setOpen(false);
    });
}

onAuthStateChanged(auth, (user) => {
    renderNav(user);
    if (!user && document.body.dataset.auth === "required") {
        location.replace("/login?next=" + encodeURIComponent(location.pathname));
    }
});
