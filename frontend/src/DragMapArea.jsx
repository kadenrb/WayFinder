// DRAG MAP AREA — concise overview
// Drag-and-drop image input. Emits the selected image URL to the parent.
import React, { useRef, useState } from "react";

function DragMapArea({ onImageSelected }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [blob, setBlob] = useState(null);
    const [fileName, setFileName] = useState("map.png");
    const [status, setStatus] = useState("");
    const fileInputRef = useRef(null);

    const handleFiles = (files) => {
        if (!files || !files.length) return;
        const f = files[0];
        if (!f.type.startsWith("image/")) {
            setStatus("That file is not an image.");
            return;
        }
        setBlob(f);
        setFileName(f.name || "map.png");

        const url = URL.createObjectURL(f);
        setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
        });
        setStatus(`${f.name} (${(f.size / 1024).toFixed(1)} KB)`);
        try { onImageSelected && onImageSelected(url, { file: f, name: f.name }); } catch {}
    };

    const onDrop = (e) => {
        e.preventDefault(); e.stopPropagation();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    };

    const onDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
    const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
    const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };

    const onPick = (e) => {
        handleFiles(e.target.files);
        e.target.value = ""; // allow re-selecting same file
    };

    async function saveWithFileSystemAccess() {
        const suggested = fileName || "map.png";
        const ext = suggested.includes(".") ? suggested.split(".").pop() : "png";
        const mime = blob?.type || "image/png";

        const handle = await window.showSaveFilePicker({
            suggestedName: suggested, // pick your frontend folder in the dialog
            types: [{ description: "Image", accept: { [mime]: ["." + ext] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(`Saved: ${handle.name}`);
    }

    function saveWithDownloadFallback() {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || "map.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus(`Download started: ${a.download}`);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    const onSave = async () => {
        if (!blob) { setStatus("Add an image first."); return; }
        try {
            if ("showSaveFilePicker" in window && typeof window.showSaveFilePicker === "function") {
                await saveWithFileSystemAccess();
            } else {
                saveWithDownloadFallback();
            }
        } catch (err) {
            if (err?.name === "AbortError") return;
            console.error(err);
            setStatus("Couldn’t save. Using download fallback…");
            saveWithDownloadFallback();
        }
    };

    return (
        <section>
            <div
                className={`map-dropzone ${dragOver ? "is-dragover" : ""} ${previewUrl ? "has-image" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                role="button"
                aria-label="Drag map.png here or click to choose"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
            >
                {!previewUrl && (
                    <div className="map-dropzone__helper">
                        <div className="map-dropzone__dashes">────────────────────────────</div>
                        <div className="map-dropzone__text">
                            drag <strong>map.png</strong> here
                        </div>
                        <div className="map-dropzone__dashes">────────────────────────────</div>
                        <div className="map-dropzone__hint">(or click to choose an image)</div>
                    </div>
                )}
                {previewUrl && <img className="map-dropzone__img" src={previewUrl} alt="Map preview" />}
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPick} />
            </div>

            <div className="map-actions">
                <button className="map-btn" onClick={onSave} disabled={!blob}>
                    Save image…
                </button>
                <span className="map-status" aria-live="polite">{status}</span>
            </div>
        </section>
    );
}

export default DragMapArea;
