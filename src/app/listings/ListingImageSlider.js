"use client";

import { useState } from "react";
import Image from "next/image";

function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return false;
  try {
    if (urlString.startsWith("/")) return true;
    if (urlString.startsWith("data:")) return true;
    new URL(urlString);
    return true;
  } catch (e) {
    try {
      if (urlString.includes(".") && !urlString.startsWith("http")) {
        new URL("https://" + urlString);
        return true;
      }
    } catch (e2) { }
    return false;
  }
}

export default function ListingImageSlider({ images, title }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedImages, setFailedImages] = useState(new Set());

  const validImages = Array.isArray(images)
    ? images.filter(img => typeof img === "string" && img.trim() !== "")
    : [];

  if (validImages.length === 0) {
    return (
      <div className="flex aspect-[16/9] flex-col items-center justify-center rounded-3xl bg-slate-900 ring-1 ring-inset ring-white/10">
        <svg className="h-16 w-16 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        <span className="mt-4 text-sm font-medium uppercase tracking-wider text-slate-500">No images available</span>
      </div>
    );
  }

  const next = () => {
    setCurrentIndex((prev) => (prev + 1) % validImages.length);
  };

  const prev = () => {
    setCurrentIndex((prev) => (prev - 1 + validImages.length) % validImages.length);
  };

  const handleImageError = () => {
    setFailedImages((prev) => new Set(prev).add(currentIndex));
  };

  const currentImage = validImages[currentIndex];
  let srcToUse = currentImage;
  if (currentImage && !currentImage.startsWith("/") && !currentImage.startsWith("data:") && !currentImage.startsWith("http")) {
    srcToUse = `https://${currentImage}`;
  }
  const isFailed = failedImages.has(currentIndex) || !isValidUrl(currentImage);

  return (
    <div className="space-y-4">
      <div className="group relative aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-slate-950">
        {isFailed ? (
          <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900">
            <svg className="h-16 w-16 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="mt-4 text-sm text-slate-500">This image could not be loaded</span>
          </div>
        ) : (
          <Image
            src={srcToUse}
            alt={`${title} - Image ${currentIndex + 1}`}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
            onError={handleImageError}
          />
        )}

        {validImages.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-3 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
              aria-label="Previous image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={next}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-3 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
              aria-label="Next image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2">
              {validImages.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  className={`h-2 rounded-full transition-all ${i === currentIndex ? "w-8 bg-white" : "w-2 bg-white/40 hover:bg-white/60"
                    }`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {validImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {validImages.map((img, i) => {
            let thumbSrc = img;
            if (img && !img.startsWith("/") && !img.startsWith("data:") && !img.startsWith("http")) {
              thumbSrc = `https://${img}`;
            }
            return (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`relative h-20 w-32 shrink-0 overflow-hidden rounded-xl transition-all ${i === currentIndex ? "ring-2 ring-emerald-400" : "opacity-60 hover:opacity-100"
                  }`}
              >
                {isValidUrl(img) ? (
                  <Image
                    src={thumbSrc}
                    alt=""
                    fill
                    sizes="128px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-900 text-[10px] text-slate-500">
                    Invalid
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
