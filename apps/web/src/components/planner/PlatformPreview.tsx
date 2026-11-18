import React from 'react';
import { Heart, MessageCircle, Share2, Bookmark, Music2, ThumbsUp, Repeat2, BarChart2, Send } from 'lucide-react';
import { PlatformIcon, PlatformId, PLATFORMS } from './platforms';
import { mediaSrc } from './PostCard';

/** Phone-frame preview of how a post will look on each platform (approximate). */
export const PlatformPreview: React.FC<{
  platform: PlatformId;
  username: string;
  caption: string;
  title?: string | null;
  firstComment?: string | null;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  isImage?: boolean;
}> = ({ platform, username, caption, title, firstComment, thumbnailUrl, mediaUrl, isImage }) => {
  const feed = platform === 'linkedin' || platform === 'x' || platform === 'facebook';
  const media = mediaUrl ? (
    isImage ? (
      <img src={mediaSrc(mediaUrl)} alt="" className="w-full h-full object-cover" />
    ) : (
      <video src={mediaSrc(mediaUrl)} poster={mediaSrc(thumbnailUrl)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
    )
  ) : (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-zinc-400 bg-zinc-800">No media yet</div>
  );
  const handle = username.replace(/^@?/, '@');
  const cap = caption || 'Your caption appears here';

  return (
    <div className="mx-auto w-[220px] rounded-[28px] border-[6px] border-zinc-900 bg-black shadow-xl overflow-hidden" aria-label={`${PLATFORMS[platform].name} preview`}>
      <div className="relative" style={{ aspectRatio: '9 / 19' }}>
        {feed ? (
          <div className="absolute inset-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
            <div className="flex items-center gap-2 p-2.5">
              <PlatformIcon platform={platform} size={22} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold truncate">{handle}</p>
                <p className="text-[9px] text-zinc-500">Just now</p>
              </div>
            </div>
            <p className="px-2.5 pb-2 text-[10px] leading-snug whitespace-pre-wrap break-words">{cap.slice(0, platform === 'x' ? 280 : 400)}</p>
            <div className="mx-2.5 rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9 / 13' }}>
              {media}
            </div>
            <div className="flex justify-around py-2 text-zinc-500">
              {platform === 'x' ? (
                <>
                  <MessageCircle className="w-3.5 h-3.5" /> <Repeat2 className="w-3.5 h-3.5" /> <Heart className="w-3.5 h-3.5" /> <BarChart2 className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <ThumbsUp className="w-3.5 h-3.5" /> <MessageCircle className="w-3.5 h-3.5" /> <Repeat2 className="w-3.5 h-3.5" /> <Send className="w-3.5 h-3.5" />
                </>
              )}
            </div>
            {firstComment && (
              <div className="mx-2.5 mb-3 p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[9px]">
                <b>{handle}</b> {firstComment}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="absolute inset-0">{media}</div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
            <div className="absolute top-2 left-0 right-0 text-center text-[10px] font-semibold text-white/90">
              {platform === 'tiktok' ? 'Following  |  For You' : platform === 'youtube' ? 'Shorts' : 'Reels'}
            </div>
            <div className="absolute right-1.5 bottom-16 flex flex-col items-center gap-3 text-white">
              <Heart className="w-5 h-5" />
              <MessageCircle className="w-5 h-5" />
              {platform === 'instagram' ? <Send className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
              {platform !== 'youtube' && <Bookmark className="w-5 h-5" />}
            </div>
            <div className="absolute left-2 right-9 bottom-3 text-white space-y-1">
              <p className="text-[11px] font-bold flex items-center gap-1">
                <PlatformIcon platform={platform} size={14} /> {handle}
              </p>
              {platform === 'youtube' && title && <p className="text-[11px] font-semibold leading-tight line-clamp-2">{title}</p>}
              <p className="text-[10px] leading-snug line-clamp-3 whitespace-pre-wrap break-words">{cap}</p>
              {platform === 'tiktok' && (
                <p className="text-[9px] flex items-center gap-1 opacity-90">
                  <Music2 className="w-3 h-3" /> original sound
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
