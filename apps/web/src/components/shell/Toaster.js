import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/useToastStore';
export const Toaster = () => {
    const { toasts, dismiss } = useToastStore();
    if (!toasts.length)
        return null;
    return (_jsx("div", { className: "fixed z-[70] top-16 sm:top-20 right-3 sm:right-6 left-3 sm:left-auto flex flex-col gap-2 sm:w-96 pointer-events-none", role: "status", "aria-live": "polite", children: toasts.map((t) => {
            const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : Info;
            const tone = t.kind === 'success' ? 'text-emerald-600' : t.kind === 'error' ? 'text-rose-600' : 'text-[#5b3bb5]';
            return (_jsxs("div", { className: "pointer-events-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg rounded-2xl p-3 flex gap-2.5 items-start", children: [_jsx(Icon, { className: `w-5 h-5 shrink-0 mt-0.5 ${tone}` }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-sm font-semibold", children: t.title }), t.body && _jsx("p", { className: "text-xs text-zinc-500 mt-0.5 line-clamp-3 break-words", children: t.body }), t.action && (_jsx("button", { onClick: () => {
                                    t.action.onClick();
                                    dismiss(t.id);
                                }, className: "mt-1.5 text-xs font-semibold text-[#5b3bb5] hover:underline", children: t.action.label }))] }), _jsx("button", { onClick: () => dismiss(t.id), "aria-label": "Dismiss", className: "p-1 -m-1 rounded-lg text-zinc-400 hover:text-zinc-600", children: _jsx(X, { className: "w-4 h-4" }) })] }, t.id));
        }) }));
};
