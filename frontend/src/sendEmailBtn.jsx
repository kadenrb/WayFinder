// send email button component
// send a notification email to all registered users via backend endpoints 
// provides visula feedback during sending and displaying results 

import { useState } from "react";

// base API URL from environment variable or default to localhost
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

function sendEmailBtn() {
  // local state 
  const [loading, setLoading] = useState(false); // tracks wheather emails are being sent
  const [message, setMessage] = useState(""); // stores success or error messages to display 

  // handler for sending emails 
  const handleSend = async () => {
    setLoading(true); // show loading state 
    setMessage(""); // clear previous messages
    try {
      // post request to backend to trigger email sending
      const res = await fetch(`${API_URL}/auth/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      // hadnle response from backend 
      if (data.success) {
        // display success message with list of emails sent
        setMessage(`Emails sent to: ${data.emailsSent.join(", ")}`);
      } else {
        // display error message if no users found
        setMessage("No users found.");
      }
    } catch (err) {
      // log and display any errors during the fetch process
      console.error(err);
      setMessage("Error sending emails.");
    }
    setLoading(false);
  };
  // JSX for the button and message display
  return (
    <div>
      {/* Button triggers email sending; disabled while loading */}
      <button onClick={handleSend} disabled={loading}>
        {loading ? "Sending..." : "Send Email"}
      </button>
      {/* Display message if exists */}
      {message && <p>{message}</p>}
    </div>
  );
}

export default sendEmailBtn;
