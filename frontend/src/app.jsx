import React from "react";
import SendEmailBtn from "./sendEmailBtn";
import DragMapArea from "./DragMapArea";

function App() {
  return (
    <div style={{ padding: "2rem", display: "grid", gap: "1.25rem" }}>
      <h1>Send Email Example</h1>

      {/* Drag-and-drop map area */}
      <DragMapArea />

      {/* Existing email button */}
      <SendEmailBtn />
    </div>
  );
}

export default App;
