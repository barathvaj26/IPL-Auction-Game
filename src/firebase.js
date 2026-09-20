import { initializeApp } from "firebase/app"

import {
  getFirestore,
} from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyCOFQHEI-PtTEaZ-6uuKOWizTHYRAv1DTc",
  authDomain: "ipl-auction-ai.firebaseapp.com",
  projectId: "ipl-auction-ai",
  storageBucket: "ipl-auction-ai.firebasestorage.app",
  messagingSenderId: "1096248547861",
  appId: "1:1096248547861:web:0ffb1f22fa371ebc178c1c",
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Firestore Database
export const db = getFirestore(app)

export default app