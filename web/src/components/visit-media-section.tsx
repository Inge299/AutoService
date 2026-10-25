import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { VisitMediaGallery } from "@/components/visit-media-gallery";
import { workshopRepository } from "@/lib/repository";

export async function VisitMediaSection({ visitId, total }: { visitId: string; total: number }) {
  let media;
  try { media = await workshopRepository.getVisitMedia(visitId); }
  catch { return <section className="section-block" id="media"><h2>Материалы</h2><p className="form-error" role="status">Не удалось получить материалы. Обновите страницу и попробуйте снова.</p></section>; }
  return <section className="section-block" id="media"><div className="section-heading"><div><h2>Материалы</h2><p>Фото, видео и голосовые заметки, подтверждённые сервером</p></div><StatusPill label={`${media.length} файлов`} tone="neutral" /></div>
    {total > media.length && <p className="muted">Ещё {total - media.length} файлов загружаются, проверяются или ожидают повторной отправки.</p>}
    {media.length ? <VisitMediaGallery media={media} /> : <div className="empty-inline"><Icon name="camera" /><p><strong>Подтверждённых материалов пока нет</strong><small>Они появятся после загрузки и проверки файлов из Android.</small></p></div>}
  </section>;
}
