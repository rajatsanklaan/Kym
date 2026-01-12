"use client";

import { useEffect, useRef } from "react";

export default function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Ensure video plays on load
    const playVideo = async () => {
      try {
        await video.play();
      } catch (error) {
        // Auto-play may fail in some browsers, but that's okay
        console.log("Video autoplay prevented:", error);
      }
    };

    playVideo();

    // Handle video loop
    const handleEnded = () => {
      video.currentTime = 0;
      video.play();
    };

    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("ended", handleEnded);
    };
  }, []);

  return (
    <div className="fixed inset-0 w-full h-full z-0 pointer-events-none overflow-hidden">
      <video
        ref={videoRef}
        className="absolute top-1/2 left-1/2 min-w-full min-h-full w-auto h-auto -translate-x-1/2 -translate-y-1/2 object-cover"
        autoPlay
        muted
        loop
        playsInline
        style={{ opacity: 0.6 }}
      >
        <source src="/background-video.mp4" type="video/mp4" />
        {/* Fallback: If the video doesn't load, we can add a poster or alternative */}
      </video>
      {/* Overlay to ensure text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-900/20 via-transparent to-blue-900/20 pointer-events-none" />
    </div>
  );
}

