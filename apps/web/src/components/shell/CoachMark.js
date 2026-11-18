import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';
export const CoachMark = ({ popupKey }) => {
    const { popups, markPopupSeenLocal } = useAppStore();
    const popup = popups.find((p) => p.key === popupKey && !p.seen);
    if (!popup)
        return null;
    const dismiss = async () => {
        markPopupSeenLocal(popupKey);
        await apiFetch('/api/v1/pop-up/record-popup-timing', {
            method: 'POST',
            body: JSON.stringify({ popupKey }),
        });
    };
    return (_jsxs("div", { className: "bg-[#5b3bb5] text-white p-4 rounded-xl shadow-lg max-w-xs space-y-2 animate-fade-in", children: [_jsx("h4", { className: "text-xs font-bold", children: popup.title }), _jsx("p", { className: "text-[11px] text-purple-100 leading-relaxed", children: popup.description }), _jsx("div", { className: "flex justify-end", children: _jsx("button", { onClick: dismiss, className: "px-3 py-1 rounded-lg bg-white text-[#5b3bb5] text-xs font-bold hover:bg-purple-50", children: "Got it" }) })] }));
};
