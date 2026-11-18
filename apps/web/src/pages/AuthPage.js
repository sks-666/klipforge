import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Mail, Lock, User, Sparkles, AlertCircle, Check } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { DEMO_CREDENTIALS, login, register } from '../lib/session';
const passwordChecks = (pw) => [
    { label: 'At least 8 characters', ok: pw.length >= 8 },
    { label: 'Contains a letter', ok: /[A-Za-z]/.test(pw) },
    { label: 'Contains a number', ok: /\d/.test(pw) },
];
const inputClass = 'w-full pl-10 pr-3 py-2.5 rounded-xl border bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none transition focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500';
export const AuthPage = ({ mode }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const user = useAppStore((s) => s.user);
    const redirectTo = location.state?.from?.pathname || '/workspace';
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(null);
    const [error, setError] = useState(null);
    const checks = useMemo(() => passwordChecks(password), [password]);
    const isRegister = mode === 'register';
    if (user)
        return _jsx(Navigate, { to: redirectTo, replace: true });
    const fail = (e) => {
        const message = e?.status === undefined
            ? 'Cannot reach the KlipForge API. Is the server running?'
            : e?.message || 'Something went wrong';
        setError({ message, field: e?.field });
    };
    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        if (isRegister) {
            if (!name.trim())
                return setError({ message: 'Name is required', field: 'name' });
            if (checks.some((c) => !c.ok))
                return setError({ message: 'Password does not meet the requirements', field: 'password' });
            if (password !== confirm)
                return setError({ message: 'Passwords do not match', field: 'confirm' });
        }
        setSubmitting('form');
        try {
            if (isRegister)
                await register(name.trim(), email.trim(), password);
            else
                await login(email.trim(), password);
            navigate(redirectTo, { replace: true });
        }
        catch (err) {
            fail(err);
        }
        finally {
            setSubmitting(null);
        }
    };
    const useDemo = async () => {
        setError(null);
        setSubmitting('demo');
        try {
            await login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
            navigate(redirectTo, { replace: true });
        }
        catch (err) {
            fail(err);
        }
        finally {
            setSubmitting(null);
        }
    };
    const borderFor = (field) => error?.field === field ? 'border-rose-400' : 'border-zinc-200 dark:border-zinc-700';
    return (_jsx("div", { className: "min-h-dvh bg-gradient-to-br from-purple-50 via-white to-fuchsia-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-purple-950/40 flex items-center justify-center px-4 py-10", children: _jsxs("div", { className: "w-full max-w-sm", children: [_jsxs("div", { className: "flex items-center justify-center gap-2 mb-6", children: [_jsx("div", { className: "w-9 h-9 rounded-xl bg-gradient-to-br from-[#5b3bb5] to-fuchsia-600 text-white font-bold flex items-center justify-center", children: "K" }), _jsx("span", { className: "text-lg font-bold text-zinc-900 dark:text-white", children: "KlipForge" })] }), _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-purple-900/5 p-6 sm:p-7", children: [_jsx("h1", { className: "text-xl font-bold text-zinc-900 dark:text-white", children: isRegister ? 'Create your account' : 'Welcome back' }), _jsx("p", { className: "text-xs text-zinc-500 mt-1", children: isRegister
                                ? 'Start with 47 free credits. No card required.'
                                : 'Log in to your KlipForge workspace.' }), error && (_jsxs("div", { role: "alert", className: "mt-4 flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300", children: [_jsx(AlertCircle, { className: "w-4 h-4 shrink-0 mt-px" }), _jsx("span", { children: error.message })] })), _jsxs("form", { onSubmit: onSubmit, className: "mt-5 space-y-3.5", noValidate: true, children: [isRegister && (_jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "name", className: "text-xs font-semibold text-zinc-600 dark:text-zinc-300", children: "Full name" }), _jsxs("div", { className: "relative", children: [_jsx(User, { className: "w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" }), _jsx("input", { id: "name", autoComplete: "name", value: name, onChange: (e) => setName(e.target.value), placeholder: "Alex Rivera", className: `${inputClass} ${borderFor('name')}`, autoFocus: true })] })] })), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "email", className: "text-xs font-semibold text-zinc-600 dark:text-zinc-300", children: "Email" }), _jsxs("div", { className: "relative", children: [_jsx(Mail, { className: "w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" }), _jsx("input", { id: "email", type: "email", autoComplete: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@company.com", className: `${inputClass} ${borderFor('email')}`, autoFocus: !isRegister })] })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "password", className: "text-xs font-semibold text-zinc-600 dark:text-zinc-300", children: "Password" }), _jsxs("div", { className: "relative", children: [_jsx(Lock, { className: "w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" }), _jsx("input", { id: "password", type: showPassword ? 'text' : 'password', autoComplete: isRegister ? 'new-password' : 'current-password', required: true, value: password, onChange: (e) => setPassword(e.target.value), placeholder: isRegister ? 'Create a password' : 'Your password', className: `${inputClass} pr-10 ${borderFor('password')}` }), _jsx("button", { type: "button", onClick: () => setShowPassword((v) => !v), "aria-label": showPassword ? 'Hide password' : 'Show password', className: "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800", children: showPassword ? _jsx(EyeOff, { className: "w-4 h-4" }) : _jsx(Eye, { className: "w-4 h-4" }) })] }), isRegister && password.length > 0 && (_jsx("ul", { className: "pt-1 space-y-0.5", children: checks.map((c) => (_jsxs("li", { className: `flex items-center gap-1.5 text-[11px] ${c.ok ? 'text-emerald-600' : 'text-zinc-400'}`, children: [_jsx(Check, { className: "w-3 h-3" }), " ", c.label] }, c.label))) }))] }), isRegister && (_jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "confirm", className: "text-xs font-semibold text-zinc-600 dark:text-zinc-300", children: "Confirm password" }), _jsxs("div", { className: "relative", children: [_jsx(Lock, { className: "w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" }), _jsx("input", { id: "confirm", type: showPassword ? 'text' : 'password', autoComplete: "new-password", value: confirm, onChange: (e) => setConfirm(e.target.value), placeholder: "Repeat your password", className: `${inputClass} ${borderFor('confirm')}` })] })] })), _jsxs("button", { type: "submit", disabled: submitting !== null, className: "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 hover:opacity-95 disabled:opacity-60 shadow-sm", children: [submitting === 'form' && _jsx(Loader2, { className: "w-4 h-4 animate-spin" }), isRegister ? 'Create account' : 'Log in'] })] }), !isRegister && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-3 my-4", children: [_jsx("div", { className: "h-px flex-1 bg-zinc-200 dark:bg-zinc-800" }), _jsx("span", { className: "text-[11px] text-zinc-400", children: "or" }), _jsx("div", { className: "h-px flex-1 bg-zinc-200 dark:bg-zinc-800" })] }), _jsxs("button", { type: "button", onClick: useDemo, disabled: submitting !== null, className: "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border border-purple-200 dark:border-purple-800 text-[#5b3bb5] dark:text-purple-300 bg-purple-50/60 dark:bg-purple-950/40 hover:bg-purple-100/70 disabled:opacity-60", children: [submitting === 'demo' ? (_jsx(Loader2, { className: "w-4 h-4 animate-spin" })) : (_jsx(Sparkles, { className: "w-4 h-4" })), "Continue with demo account"] })] })), _jsxs("p", { className: "text-xs text-zinc-500 text-center mt-5", children: [isRegister ? 'Already have an account?' : "Don't have an account?", ' ', _jsx(Link, { to: isRegister ? '/login' : '/register', state: location.state, onClick: () => setError(null), className: "font-semibold text-[#5b3bb5] dark:text-purple-300 hover:underline", children: isRegister ? 'Log in' : 'Sign up free' })] })] })] }) }));
};
