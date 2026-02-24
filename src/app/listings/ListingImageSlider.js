"use client";

import { useState } from "react";
import Image from "next/image";

export default function ListingImageSlider({ images, title }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imgError, setImgError] = useState(false);

  if (!Array.isArray(images) || images.length === 0 || imgError) {
    return (
      <div className="flex aspect-[16/9] flex-col items-center justify-center rounded-3xl bg-slate-900 ring-1 ring-inset ring-white/10">
        <svg
          className="h-16 w-16 text-slate-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
          />
        </svg>
        <span className="mt-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          {imgError ? "Image error" : "No images available"}
        </span>
      </div>
    );
  }

  const next = () => {
    setImgError(false);
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const prev = () => {
    setImgError(false);
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div className="space-y-4">
      <div className="group relative aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60">
        <Image
          src={images[currentIndex]}
          alt={`${title} - Image ${currentIndex + 1}`}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
          onError={() => setImgError(true)}
        />

        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-2 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
              aria-label="Previous image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={next}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-2 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
              aria-label="Next image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  className={`h-1.5 w-1.5 rounded-full transition-all ${i === currentIndex ? "w-4 bg-white" : "bg-white/50"
                    }`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-3">
          {images.slice(0, 5).map((src, i) => (
            <button
              key={src}
              onClick={() => setCurrentIndex(i)}
              className={`relative aspect-[16/10] overflow-hidden rounded-xl border transition ${i === currentIndex ? "border-emerald-400 ring-2 ring-emerald-400/20" : "border-white/10 hover:border-white/30"
                }`}
            >
              <Image
                src={src}
                alt={`${title} thumbnail ${i + 1}`}
                fill
                sizes="(min-width: 1024px) 10vw, 20vw"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
