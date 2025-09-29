import React, { useEffect, useRef } from "react";

export default function SubtitleDisplay({ subtitles, currentSubtitleIndex }) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentSubtitleIndex]);

  if (!subtitles || subtitles.length === 0) {
    return <div className="mt-4 text-gray-400 italic text-center">No subtitles</div>;
  }

  return (
    <div
      ref={containerRef}
      className="mt-6 flex flex-col items-center space-y-3 text-center max-h-96 overflow-y-auto w-full px-4 py-4 bg-gray-900 rounded-lg shadow-inner"
    >
      {subtitles.map((s, i) => {
        const isActive = i === currentSubtitleIndex;
        const isPast = i < currentSubtitleIndex;
        const isFuture = i > currentSubtitleIndex;

        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            className={`transition-all duration-500 ease-in-out w-full max-w-3xl px-6 py-3 rounded-lg transform ${
              isActive
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-2xl scale-105 animate-pulse"
                : isPast
                ? "bg-gray-700 text-gray-300 opacity-60 scale-95"
                : "bg-gray-800 text-gray-400 opacity-40 scale-90"
            }`}
            style={{ fontSize: isActive ? "1.125rem" : "1rem", lineHeight: isActive ? "1.6" : "1.5" }}
          >
            {s.text}
          </div>
        );
      })}
      <div className="h-20"></div>
    </div>
  );
}
