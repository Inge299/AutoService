"use client";

/* eslint-disable @next/next/no-img-element -- short-lived storage URLs are supplied by the authenticated API. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VisitMedia } from "@/lib/domain";

const labels = { PHOTO: "Фото", VIDEO: "Видео", VOICE: "Голосовая заметка" };

function MediaItem({ media, index }: { media: VisitMedia; index: number }) {
  const [failed, setFailed] = useState(false);
  const label = `${labels[media.kind]} ${index + 1}`;
  return <figure className={`visit-media-item visit-media-${media.kind.toLowerCase()}`}>
    {failed ? <div className="visit-media-error" role="status">Не удалось загрузить файл. Обновите ссылки или попробуйте открыть оригинал.</div>
      : media.kind === "PHOTO" ? <a href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={label} loading="lazy" onError={() => setFailed(true)} /></a>
      : media.kind === "VIDEO" ? <video controls playsInline preload="metadata" aria-label={label} onError={() => setFailed(true)}><source src={media.url} type={media.mimeType} /></video>
      : <div className="visit-media-audio"><span>Голосовая заметка мастера</span><audio controls preload="metadata" aria-label={label} onError={() => setFailed(true)}><source src={media.url} type={media.mimeType} /></audio></div>}
    <figcaption><span>{label}</span><a href={media.url} target="_blank" rel="noreferrer">Открыть оригинал</a></figcaption>
  </figure>;
}

export function VisitMediaGallery({ media }: { media: VisitMedia[] }) {
  const router = useRouter();
  return <><div className="visit-media-toolbar"><p>Фото открываются в полном размере; видео и голос можно воспроизвести здесь.</p><button type="button" className="button button-secondary" onClick={() => router.refresh()}>Обновить ссылки</button></div><div className="media-grid">{media.map((item, index) => <MediaItem key={`${item.id}:${item.url}`} media={item} index={index} />)}</div></>;
}
