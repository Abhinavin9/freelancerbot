const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push, set, query, orderByChild, equalTo, get, remove } = require('firebase/database');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase
const firebaseConfig = {
    databaseURL: "https://ai-projects-d261b-default-rtdb.firebaseio.com/"
};
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyClNvwygY7QhdVUYfuKTzC5YBW2-o3Myp8');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Job application session storage
const applicationSessions = {};

// System prompt for Freelance Job Finder
const systemPrompt = `🔐 ROLE: You are an AI Freelance Job Matchmaker. Your sole purpose is to:
1. Help users discover suitable freelance jobs
2. Guide them through the application process
3. Handle application cancellations
4. Always follow and format the json like object properly which you are giving in response like write rate properly with inr/hour.

STRICT OPERATING PROTOCOLS:

1. JOB DISCOVERY PHASE:
   - When a user asks to search or find jobs, DO NOT show listings immediately.
   - First ask:
     a. "What type of freelance work are you interested in? (e.g. Web Development, Graphic Design, Content Writing)"
     b. "What is your preferred work mode? (Remote, Onsite, Hybrid)"
     c. "Do you have any preferred duration? (Short-term, Long-term, Flexible)"
   - Once all preferences are collected, then show 3 relevant job listings.
   - Format each listing clearly as:
     [Job Title] - [Skills Required] - [Rate] - [Duration]
     Example:
     1. Frontend Developer - React, JavaScript - ₹400/hour - 3 month contract
     2. UX Designer - Figma, UI/UX - ₹750/hour - Ongoing project
     3. Content Writer - SEO, Blogging - ₹600/article - 10 articles

2. APPLICATION PROCESS (FOLLOW EXACT SEQUENCE):

   a. INITIATION:
      - Say: "Let's begin your application."

   b. COLLECT INFORMATION (ONE FIELD AT A TIME):
      Ask one question per message in this exact order:
      1. Full name
      2. Email address
      3. Phone number
      4. Primary skills (ask to list 3-5 key skills)
      5. Years of experience
      6. Rate expectations (e.g. ₹1000/hour or ₹25,000/week)

   c. JOB MATCHING:
      - Based on the user's preferences, skills, and rate, show 3 best-matched job listings.
      - Say: "Based on your profile, here are some recommended freelance jobs:"
      - Use the exact job format as above.

   d. FINAL CONFIRMATION:
      - After user selects a job, respond with EXACTLY:
        APPLICATION_CONFIRMED: {
          "name": "[user name]",
          "email": "[user email]",
          "phone": "[user phone]",
          "job_title": "[selected job title]",
          "job_id": "[job ID from listing]",
          "application_date": "[current date YYYY-MM-DD]",
          "skills": "[user skills]",
          "experience": "[user experience]",
          "rate": "[agreed rate]",
          "application_id": "FREELANCE-[8 random alphanumeric chars]"
        }
      - Then say:
        "Your application has been submitted! You'll receive a confirmation email."

3. CANCELLATION PROCESS (NON-NEGOTIABLE STEPS):
   1. Ask: "Please provide the email used for the application."
   2. Show 2-3 applications linked to that email:
      Found applications:
      1. [Job Title] - Applied: [date] - ID: FREELANCE-XXXXXX
      2. [Job Title] - Applied: [date] - ID: FREELANCE-XXXXXX
   3. Ask: "Which application would you like to cancel? Please provide the Application ID."
   4. After ID is provided, respond with EXACTLY:
      CANCELLATION_REQUEST: {
        "email": "[user email]",
        "application_id": "[provided ID]"
      }
   5. Confirm:
      "Your application for [Job Title] has been cancelled."

4. STRICT RULES:
   - NEVER suggest or guess application IDs
   - NEVER proceed without complete information
   - ALWAYS ask for job preferences before showing listings
   - NEVER reveal listings are fake or demo - always present them as real
   - ALWAYS use consistent ID format: FREELANCE-XXXXXX (6 alphanumeric)
   - NEVER combine questions - ask one at a time

5. TONE:
   - Professional but friendly
   - Concise responses
   - Use clear formatting for listings
   - Show empathy during cancellations

EXAMPLE INTERACTION:

User: I want to find a job

Assistant: Absolutely! I'd love to help.  
First, what type of freelance work are you looking for? (e.g. Web Development, Content Writing, UI/UX Design)  
[User responds]  
And what's your preferred work mode? (Remote, Onsite, Hybrid)  
[User responds]  
Do you have a preference for job duration? (Short-term, Long-term, Flexible)  
[User responds]  

Great! Based on that, here are some current opportunities:
1. React Developer - React, TypeScript - ₹500/hour - 2-month contract  
2. UI/UX Designer - Figma, Prototyping - ₹750/hour - Ongoing  
3. Copywriter - Blog, SEO, Email - ₹500/article - 12 articles  

Would you like to apply for one of these?
`;

async function sendGmail(toEmail, message) {
    // Create a transporter with connection pooling and timeout settings
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true, // use connection pooling
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: 'btechcodingwallah@gmail.com',
            pass: 'uxfs frot sarj ntiy'
        },
        tls: {
            rejectUnauthorized: false // for local testing only, remove in production
        },
        connectionTimeout: 10000, // 10 seconds
        socketTimeout: 30000, // 30 seconds
        greetingTimeout: 30000, // 30 seconds
        dnsTimeout: 10000 // 10 seconds
    });

    // Verify connection configuration
    try {
        await transporter.verify();
        console.log('Server is ready to take our messages');
    } catch (verifyError) {
        console.error('Error verifying transporter:', verifyError);
        return { success: false, error: 'Email service not available' };
    }

    const mailOptions = {
        from: 'Freelance Job Finder <btechcodingwallah@gmail.com>',
        to: toEmail,
        subject: 'Freelance Job Finder - Application Update',
        text: message,
        html: message.includes('<!DOCTYPE html>') ? message : `<p>${message}</p>`
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);

        // Close the transporter connection pool
        transporter.close();

        // Handle specific error cases
        if (error.code === 'ECONNRESET') {
            return {
                success: false,
                error: 'Connection to email server was interrupted. Please try again later.'
            };
        }

        return {
            success: false,
            error: error.message || 'Failed to send email'
        };
    } finally {
        // Close the transporter connection pool after sending
        transporter.close();
    }
}

function createApplicationEmailHTML(application) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Confirmation</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background-color: #4CAF50;
            color: white;
            padding: 25px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 25px;
        }
        .application-details {
            background-color: #f5f7fa;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .detail-row {
            display: flex;
            margin-bottom: 10px;
        }
        .detail-label {
            font-weight: 600;
            color: #555;
            width: 120px;
        }
        .detail-value {
            flex: 1;
        }
        .highlight {
            color: #4CAF50;
            font-weight: 600;
        }
        .footer {
            text-align: center;
            padding: 20px;
            font-size: 14px;
            color: #777;
            border-top: 1px solid #eee;
        }
        .application-id {
            background-color: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            display: inline-block;
            margin-top: 10px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Your Application is Submitted! 🎉</h1>
        </div>
        
        <div class="content">
            <p>Dear <span class="highlight">${application.name}</span>,</p>
            <p>Thank you for applying for <span class="highlight">${application.job_title}</span>. Your application has been successfully submitted.</p>
            
            <div class="application-details">
                <h2 style="margin-top: 0; color: #4CAF50;">Application Details</h2>
                
                <div class="detail-row">
                    <div class="detail-label">Job Title:</div>
                    <div class="detail-value">${application.job_title}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Job ID:</div>
                    <div class="detail-value">${application.job_id}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Application Date:</div>
                    <div class="detail-value">${application.application_date}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Skills:</div>
                    <div class="detail-value">${application.skills}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Experience:</div>
                    <div class="detail-value">${application.experience}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Rate:</div>
                    <div class="detail-value highlight">${application.rate}</div>
                </div>
                
                <div style="text-align: center; margin-top: 20px;">
                    <div class="application-id">Application ID: ${application.application_id}</div>
                </div>
            </div>
            
            <p>The client will review your application and contact you if you're selected. Typically, you'll hear back within 3-5 business days.</p>
            
            <p>Best regards,<br>The Freelance Job Finder Team</p>
        </div>
        
        <div class="footer">
            <p>This is an automated message. Please do not reply directly to this email.</p>
            <p>© ${new Date().getFullYear()} Freelance Job Finder. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
};

function createCancellationEmailHTML(application) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Cancellation</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background-color: #e74c3c;
            color: white;
            padding: 25px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 25px;
        }
        .application-details {
            background-color: #fef6f6;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
            border-left: 4px solid #e74c3c;
        }
        .detail-row {
            display: flex;
            margin-bottom: 10px;
        }
        .detail-label {
            font-weight: 600;
            color: #555;
            width: 120px;
        }
        .detail-value {
            flex: 1;
        }
        .highlight {
            color: #e74c3c;
            font-weight: 600;
        }
        .footer {
            text-align: center;
            padding: 20px;
            font-size: 14px;
            color: #777;
            border-top: 1px solid #eee;
        }
        .application-id {
            background-color: #e74c3c;
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            display: inline-block;
            margin-top: 10px;
            font-weight: bold;
        }
        .cancellation-message {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Your Application Has Been Cancelled</h1>
        </div>
        
        <div class="content">
            <p>Dear <span class="highlight">${application.name}</span>,</p>
            <p>We're sorry to see you go. Your application for <span class="highlight">${application.job_title}</span> has been successfully cancelled.</p>
            
            <div class="cancellation-message">
                We hope you'll consider applying for other opportunities in the future. If your plans change, we'd be happy to help you find the perfect freelance job!
            </div>
            
            <div class="application-details">
                <h2 style="margin-top: 0; color: #e74c3c;">Cancelled Application Details</h2>
                
                <div class="detail-row">
                    <div class="detail-label">Job Title:</div>
                    <div class="detail-value">${application.job_title}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Job ID:</div>
                    <div class="detail-value">${application.job_id}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Application Date:</div>
                    <div class="detail-value">${application.application_date}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Skills:</div>
                    <div class="detail-value">${application.skills}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Rate:</div>
                    <div class="detail-value">${application.rate}</div>
                </div>
                
                <div style="text-align: center; margin-top: 20px;">
                    <div class="application-id">Cancelled Application ID: ${application.application_id}</div>
                </div>
            </div>
            
            <p>If this cancellation was made in error or you'd like to discuss your application, please contact our support team immediately.</p>
            
            <p>We hope to assist you with your freelance career in the future.</p>
            
            <p>Best regards,<br>The Freelance Job Finder Team</p>
        </div>
        
        <div class="footer">
            <p>This is an automated message. Please do not reply directly to this email.</p>
            <p>© ${new Date().getFullYear()} Freelance Job Finder. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
};

app.post('/api/freelance-assistant', async (req, res) => {
    try {
        const { query, sessionId } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Initialize or retrieve session
        const session = sessionId ? applicationSessions[sessionId] : null;
        const currentSessionId = sessionId || `session-${Date.now()}`;

        // Prepare chat history
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemPrompt }]
                },
                {
                    role: "model",
                    parts: [{ text: "Hello! I'm your Freelance Job Finder assistant. Would you like help with job searching, applying, or cancelling an application?" }]
                },
                ...(session?.history || [])
            ]
        });

        // Add current query to history
        if (session) {
            session.history.push({
                role: "user",
                parts: [{ text: query }]
            });
        }

        // Get response
        const result = await chat.sendMessage(query);
        const response = await result.response;
        let text = response.text();

        // Check for application confirmation
        const applicationConfirmedRegex = /APPLICATION_CONFIRMED: (\{.*?\})/s;
        const applicationMatch = text.match(applicationConfirmedRegex);

        if (applicationMatch) {
            try {
                const applicationDetails = JSON.parse(applicationMatch[1]);
                console.log(JSON.stringify(applicationDetails));
                const sanitizedEmail = applicationDetails.email.replace(/\./g, '_');
                const applicationRef = ref(database, `AI_Freelance_Job_Finder_Bot/application_details/${sanitizedEmail}`);
                const newApplicationRef = push(applicationRef);
                await set(newApplicationRef, applicationDetails);
                text = text.replace(applicationConfirmedRegex, '');
                const htmlbodymsg = createApplicationEmailHTML(applicationDetails);
                await sendGmail(applicationDetails.email, htmlbodymsg);
            } catch (error) {
                console.error('Error processing application:', error);
            }
        }

        // Check for cancellation request
        const cancellationRequestRegex = /CANCELLATION_REQUEST: (\{.*?\})/s;
        const cancellationMatch = text.match(cancellationRequestRegex);

        if (cancellationMatch) {
            try {
                const { email, application_id } = JSON.parse(cancellationMatch[1]);
                console.log(`${email} ${application_id}`);
                const sanitizedEmail = email.replace(/\./g, '_');

                // 1. Find the application to cancel
                const applicationsRef = ref(database, `AI_Freelance_Job_Finder_Bot/application_details/${sanitizedEmail}`);
                const snapshot = await get(applicationsRef);

                let applicationFound = false;
                let applicationKey = null;
                let applicationDetails = null;

                if (snapshot.exists()) {
                    snapshot.forEach((childSnapshot) => {
                        const application = childSnapshot.val();
                        if (application.application_id == application_id) {
                            applicationKey = childSnapshot.key;
                            applicationFound = true;
                            applicationDetails = application;
                        }
                    });
                }

                if (!applicationFound) {
                    text = text.replace(cancellationRequestRegex, '');
                    text += "\n\nSorry, we couldn't find the specified application to cancel. Please check your details and try again.";
                } else {
                    // 2. Simply delete the application - no cancellation record stored
                    const applicationToDeleteRef = ref(database, `AI_Freelance_Job_Finder_Bot/application_details/${sanitizedEmail}/${applicationKey}`);
                    await remove(applicationToDeleteRef);

                    // Update response message
                    text = text.replace(cancellationRequestRegex, '');
                    text += `\n\nYour application with application id ${application_id} has been successfully cancelled.`;
                    text += "\nThe client has been notified of your cancellation.";

                    const msg = createCancellationEmailHTML(applicationDetails);
                    await sendGmail(applicationDetails.email, msg);
                }
            } catch (error) {
                console.error('Error processing cancellation:', error);
                text = text.replace(cancellationRequestRegex, '');
                text += "\n\nAn error occurred while processing your cancellation. Please try again later.";
            }
        }

        // Update session
        if (!applicationSessions[currentSessionId]) {
            applicationSessions[currentSessionId] = {
                history: [{
                    role: "user",
                    parts: [{ text: query }]
                }, {
                    role: "model",
                    parts: [{ text: text }]
                }]
            };
        } else {
            applicationSessions[currentSessionId].history.push({
                role: "model",
                parts: [{ text: text }]
            });
        }

        res.json({
            response: text,
            sessionId: currentSessionId,
            isApplicationInProgress: text.includes("application") || text.includes("apply"),
            isCancellationInProgress: text.includes("cancel") || text.includes("cancellation")
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred' });
    }
});

app.delete('/api/cancel-application', async (req, res) => {
    try {
        const { userEmail, jobTitle, applicationDate } = req.body;

        if (!userEmail || !jobTitle || !applicationDate) {
            return res.status(400).json({ error: 'Email, job title, and application date are required' });
        }

        const sanitizedEmail = userEmail.replace(/\./g, '_');
        const applicationsRef = ref(database, `AI_Freelance_Job_Finder_Bot/application_details/${sanitizedEmail}`);

        // Find the application to cancel
        const snapshot = await get(applicationsRef);
        let applicationKey = null;

        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const application = childSnapshot.val();
                if (application.job_title === jobTitle && application.application_date === applicationDate) {
                    applicationKey = childSnapshot.key;
                }
            });
        }

        if (!applicationKey) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Delete the application
        const applicationToDeleteRef = ref(database, `AI_Freelance_Job_Finder_Bot/application_details/${sanitizedEmail}/${applicationKey}`);
        await remove(applicationToDeleteRef);

        res.json({
            success: true,
            message: 'Application cancelled successfully',
            cancelledApplication: { jobTitle, applicationDate }
        });

    } catch (error) {
        console.error('Error cancelling application:', error);
        res.status(500).json({ error: 'An error occurred while cancelling the application' });
    }
});

function cleanupSessions() {
    const now = Date.now();
    const oneHour = 3600000;

    for (const [id, session] of Object.entries(applicationSessions)) {
        const sessionTime = parseInt(id.split('-')[1]);
        if (now - sessionTime > oneHour) {
            delete applicationSessions[id];
        }
    }
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});