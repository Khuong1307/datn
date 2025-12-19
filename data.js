// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDTvGflmFqArRm4MvJXNCEU6F7GGZ-vsFU",
    authDomain: "datn-426e1.firebaseapp.com",
    databaseURL: "https://datn-426e1-default-rtdb.firebaseio.com",
    projectId: "datn-426e1",
    storageBucket: "datn-426e1.firebasestorage.app",
    messagingSenderId: "496143525778",
    appId: "1:496143525778:web:e59595f5bee532f40d834b",
    measurementId: "G-27WWLRE790"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Reference to power_management data
const powerRef = database.ref('power_management');

// Export for use in app.js
window.firebaseDatabase = database;
window.powerRef = powerRef;
