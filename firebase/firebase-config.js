
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDG1q45Lj9QeIcKBVTShhmqC_tUg4rMNlQ",
  authDomain: "sound-team-bcs.firebaseapp.com",
  projectId: "sound-team-bcs",
  storageBucket: "sound-team-bcs.firebasestorage.app",
  messagingSenderId: "40256826108",
  appId: "1:40256826108:web:526c21aebfade6eb530579"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
