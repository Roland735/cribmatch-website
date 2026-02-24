"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function ListingCardSlider({ images, title, href }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imgError, setImgError] = useState(false);

  if (!Array.isArray(images) || images.length === 0 || imgError) {
    return (
      <Link href={href} className="flex aspect-[16/9] flex-col items-center justify-center rounded-2xl bg-slate-900 ring-1 ring-inset ring-white/10">
        <svg
          className="h-10 w-10 text-slate-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
          />
        </svg>
        <span className="mt-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {imgError ? "Image error" : "No images"}
        </span>
      </Link>
    );
  }

  const next = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setImgError(false);
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const prev = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setImgError(false);
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div className="group relative aspect-[16/9] overflow-hidden rounded-2xl bg-slate-950/60 ring-1 ring-inset ring-white/10">
      <Link href={href} className="block h-full w-full">
        <Image
          src={images[currentIndex]}
          alt={title}
          fill
          sizes="(min-width: 1024px) 33vw, 100vw"
          className="object-cover transition duration-300 group-hover:scale-105"
          onError={() => setImgError(true)}
        />
      </Link>

      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-1 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
            aria-label="Previous image"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/50 p-1 text-white opacity-0 transition hover:bg-slate-950/80 group-hover:opacity-100"
            aria-label="Next image"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {images.slice(0, 5).map((_, i) => (
              <div
                key={i}
                className={`h-1 w-1 rounded-full transition-all ${i === currentIndex ? "w-2 bg-white" : "bg-white/50"
                  }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
