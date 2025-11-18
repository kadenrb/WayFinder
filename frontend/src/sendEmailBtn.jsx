import { useState } from "react";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

function sendEmailBtn() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSend = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (data.success) {
        setMessage(`Emails sent to: ${data.emailsSent.join(", ")}`);
      } else {
        setMessage("No users found.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error sending emails.");
    }
    setLoading(false);
  };
  // JSX for the button and message display
  return (
    <div>
      <button onClick={handleSend} disabled={loading}>
        {loading ? "Sending..." : "Send Email"}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}

export default sendEmailBtn;
