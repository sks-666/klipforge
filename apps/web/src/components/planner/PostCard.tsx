import React from 'react';
import { AlertTriangle, RotateCw, Repeat } from 'lucide-react';
import { API_BASE } from '../../lib/api';
import { fmtTime } from '../../lib/time';
import { Post, postPlatforms, postTime, STATUS_STYLE } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';

export const mediaSrc = (u?: string | null) => (u ? (u.startsWith('http') ? u : `${API_BASE}${u}`) : '');

export const canMove = (p: Post) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'draft';

/** Compact card used in calendar cells. */
export const PostCard: React.FC<{
  post: Post;
  tz: string;
  compact?: boolean;
  moving?: boolean;
  onOpen: (p: Post) => void;
  onRetry: (p: Post) => void;
  onDragStart?: (p: Post) => void;
}> = ({ post, tz, compact, moving, onOpen, onRetry, onDragStart }) => {
  const t = postTime(post);
  const st = STATUS_STYLE[post.status];
  const failed = post.status === 'failed';
  const border = failed ? 'border-rose-300 dark:border-rose-800' : post.status === 'published' ? 'border-emerald-200 dark:border-emerald-900' : 'border-zinc-200 dark:border-zinc-700';
  return (
    <div
      draggable={canMove(post)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', post.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(post);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(post);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(post)}
      title={post.caption}
      className={`group relative w-full text-left rounded-lg border ${border} bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md hover:border-[#5b3bb5]/50 transition cursor-pointer ${
        canMove(post) ? 'active:cursor-grabbing' : ''
      } ${moving ? 'ring-2 ring-[#5b3bb5]' : ''} ${post.status === 'draft' ? 'opacity-75 border-dashed' : ''}`}
    >
      <span className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${st.dot}`} />
      <div className="flex gap-1.5 p-1.5 pl-2.5">
        {post.thumbnailUrl && !compact && (
          <img src={mediaSrc(post.thumbnailUrl)} alt="" loading="lazy" className="w-6 h-10 rounded object-cover bg-zinc-200 dark:bg-zinc-800 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
            <span>{t ? fmtTime(t, tz) : 'No time'}</span>
            <span className="flex -space-x-0.5">
              {postPlatforms(post).map((pl) => (
                <PlatformIcon key={pl} platform={pl} size={12} />
              ))}
            </span>
            {post.autolistId && <Repeat className="w-3 h-3 text-zinc-400" aria-label="From an autolist" />}
          </div>
          {!compact && <p className="text-[10px] leading-tight text-zinc-500 dark:text-zinc-400 line-clamp-2 break-words">{post.caption || post.title || 'No caption'}</p>}
        </div>
      </div>
      {failed && (
        <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold">
            <AlertTriangle className="w-2.5 h-2.5" /> Failed
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry(post);
            }}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600 hover:underline"
          >
            <RotateCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
    </div>
  );
};
