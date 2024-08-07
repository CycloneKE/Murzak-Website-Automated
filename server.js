const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL connection pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'murzuk',
    password: process.env.DATABASE_PASSWORD,
    port: 5432,
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Connected to PostgreSQL database');
});

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/send-issue', async (req, res) => {
    console.log(req.body); 
    const { issue } = req.body;

    try {

        // Store user in the database with plain text password
        const reportQuery = await reportIssue(issue);

        res.send('Signup successful. Please login.');
    } catch (error) {
        console.error('Error during signup:', error);
        res.status(500).send('An error occurred during signup.');
    }
});

app.post('/submit-issue', async (req, res) => {
    console.log(req.body); 
    const { email, issue, namemodel, pcversion } = req.body;
    try {

        // Store user in the database with plain text password
        const reportIssueQuery = await reportComplexIssue(email, issue, namemodel, pcversion);

        res.send('Message Sent.');
    } catch (error) {
        console.error('Error occurred:', error);
        res.status(500).send('An error occurred during sending message.');
    }
});

// PostgreSQL helper functions
async function reportComplexIssue(email, issue, namemodel, pcversion) {
    const reportIssueQuery = 'INSERT INTO complex_issues (email, issue, namemodel, pcversion) VALUES ($1, $2, $3, $4)';
    try {
        await pool.query(reportIssueQuery, [email, issue, namemodel, pcversion]);
    } catch (error) {
        console.error('Error adding user to database:', error);
        throw error; // Rethrow the error to be caught in the signup route
    }
}

async function reportIssue(issue) {
    const reportQuery = 'INSERT INTO reported_issues (issue) VALUES ($1)';
    try {
        await pool.query(reportQuery, [issue]);
    } catch (error) {
        console.error('Error adding user to database:', error);
        throw error; // Rethrow the error to be caught in the signup route
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
