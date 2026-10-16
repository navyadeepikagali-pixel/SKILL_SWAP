import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, CircleUserRound, Code2, CreditCard, Gauge, HeartHandshake, History, Languages, LogOut, Menu, MessageCircle, Music2, RotateCw, Search, Send, ShieldCheck, Sparkles, Star, Wallet, X } from "lucide-react";
import { api, API_BASE_URL } from "./api.js";

const socketUrl = API_BASE_URL.replace(/\/api\/?$/, "");

function getMessage(error) {
  if (typeof error === "string") return error;
  return error.response?.data?.message || error.message || "Something went wrong. Please try again.";
}

function idempotencyKey(prefix = "action") {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid}`;
}

function RestrictedActionNotice({ error, onDismiss }) {
  if (!error) return null;
  const limited = error.response?.data?.code === "USAGE_LIMIT_REACHED";
  return <div className={`phase-alert ${limited ? "usage-restriction" : "error"}`} role="alert">
    <span>{getMessage(error)}</span>{limited && <Link className="button button-primary" to="/plans">View plans</Link>}
    {onDismiss && <button type="button" className="text-button" onClick={onDismiss}>Dismiss</button>}
  </div>;
}

function Brand({ light = false }) {
  return <Link className={`brand ${light ? "light" : ""}`} to="/"><span className="brand-icon">S</span>skill<span>swap</span></Link>;
}

function LandingPage() {
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    api.get("/categories").then(response => setCategories(response.data.data.categories.slice(0, 4))).catch(() => setCategories([]));
  }, []);
  const icons = [Code2, BookOpen, HeartHandshake, Music2];
  return <main className="page">
    <header className="topbar">
      <Brand />
      <nav aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <Link to="/categories">Explore skills</Link>
        <Link className="button button-light" to="/login">Sign in</Link>
        <Link className="button button-primary" to="/register">Get started</Link>
      </nav>
    </header>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={15} /> KNOWLEDGE GOES BOTH WAYS</div>
        <h1>Learn together.<br/><span>Grow together.</span></h1>
        <p>Trade what you know for what you want to learn. Find your people, share your skills, and make every lesson count.</p>
        <div className="hero-actions"><Link className="button button-primary" to="/register">Start swapping <ArrowRight size={17}/></Link><Link className="button button-light" to="/categories">Explore skills</Link></div>
        <div className="hero-footnote"><span className="avatar-stack"><i>A</i><i>M</i><i>J</i></span><span>Learn a little. Teach a little. That's the swap.</span></div>
      </div>
      <div className="hero-art" aria-label="Illustration of a community sharing skills">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="art-card art-card-top"><span className="art-icon green"><Code2 size={20}/></span><span><b>React.js</b><small>Can teach · Advanced</small></span><span className="spark">✦</span></div>
        <div className="art-card art-card-bottom"><span className="art-icon orange"><Music2 size={20}/></span><span><b>Guitar basics</b><small>Wants to learn · Beginner</small></span><span className="spark">✦</span></div>
        <div className="swap-circle"><HeartHandshake size={40}/><b>share<br/>the skill</b></div>
        <span className="float-dot dot-one"/><span className="float-dot dot-two"/><span className="float-dot dot-three"/>
      </div>
    </section>
    <section className="category-section" id="categories">
      <div className="section-heading"><div><div className="eyebrow">A WORLD OF THINGS TO LEARN</div><h2>What are you curious about?</h2></div><Link to="/categories" className="text-link">Explore all skills <ArrowRight size={15}/></Link></div>
      <div className="category-grid">{categories.map((category, index) => {
        const Icon = icons[index % icons.length];
        return <Link to={`/categories/${category.slug}`} className="category-card" key={category._id}><span className="category-icon"><Icon size={21}/></span><span><b>{category.name}</b><small>{category.description || "Explore this category"}</small></span><ArrowRight className="card-arrow" size={17}/></Link>;
      })}</div>
      {!categories.length && <p className="muted">Categories are being prepared. Please check again soon.</p>}
    </section>
    <section className="how-section" id="how-it-works"><div className="eyebrow">SIMPLE BY DESIGN</div><h2>Good things happen when we share.</h2><div className="steps"><article><span>01</span><h3>Bring what you know</h3><p>Share your skills and make a profile that feels like you.</p></article><article><span>02</span><h3>Find what you need</h3><p>Meet someone who can teach you something new.</p></article><article><span>03</span><h3>Make the swap</h3><p>Learn, teach, and keep the good stuff going.</p></article></div></section>
    <footer><Brand/><span>Built on the belief that everyone has something to teach.</span></footer>
  </main>;
}

function AuthPage({ onLogin }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [mode, setMode] = useState(() => searchParams.get("token") ? "reset" : location.pathname === "/register" ? "register" : "login");
  const [values, setValues] = useState(() => searchParams.get("token") ? { token: searchParams.get("token") } : {});
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emailOtpEnabled, setEmailOtpEnabled] = useState(true);
  const [authConfigReady, setAuthConfigReady] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    api.get("/auth/config")
      .then(result => {
        if (!active) return;
        const config = result.data.data;
        setEmailOtpEnabled(config.emailOtpEnabled);
        if (!config.passwordResetEnabled && searchParams.get("token")) {
          setMode("login");
          setValues({});
          setError("Password reset is unavailable because email delivery is disabled. Contact the administrator for help.");
        }
      })
      .catch(requestError => {
        if (active) setError(getMessage(requestError));
      })
      .finally(() => {
        if (active) setAuthConfigReady(true);
      });
    return () => { active = false; };
  }, [searchParams]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown(current => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const input = event => {
    const { name, value } = event.currentTarget;
    setValues(current => ({ ...current, [name]: value }));
  };
  const submit = async event => {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "register") {
        if (values.password !== values.confirmPassword) throw new Error("Passwords do not match");
        const { name, email: registrationEmail, password } = values;
        const result = await api.post("/auth/register", {
          name,
          email: registrationEmail,
          password
        });
        if (result.data.data.user) {
          onLogin(result.data.data.user);
          navigate("/dashboard");
          return;
        }
        setEmail(result.data.data.email);
        setCooldown(result.data.data.resendAfterSeconds);
        setMode("verify");
        setNotice("Verification code sent. Check your inbox.");
      } else if (mode === "verify") {
        await api.post("/auth/verify-email", { email, otp: values.otp });
        setMode("login");
        setValues({});
        setNotice("Email verified and account created. Sign in to continue.");
      } else if (mode === "login") {
        const result = await api.post("/auth/login", values);
        if (result.data.data.user) {
          onLogin(result.data.data.user);
          navigate("/dashboard");
          return;
        }
        setEmail(result.data.data.email);
        setCooldown(result.data.data.resendAfterSeconds);
        setMode("login-verify");
        setNotice("Sign-in code sent. Check your inbox.");
      } else if (mode === "login-verify") {
        const result = await api.post("/auth/verify-login-otp", { email, otp: values.otp });
        onLogin(result.data.data.user);
        navigate("/dashboard");
      } else if (mode === "forgot") {
        await api.post("/auth/forgot-password", { email: values.email });
        setNotice("If the account exists, reset instructions may be sent to your email.");
      } else if (mode === "reset") {
        await api.post("/auth/reset-password", { token: values.token, password: values.password });
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setError(""); setNotice("");
    try {
      const endpoint = mode === "login-verify" ? "/auth/resend-login-otp" : "/auth/resend-otp";
      const result = await api.post(endpoint, { email });
      setCooldown(result.data.data.resendAfterSeconds || 0);
      setNotice(mode === "login-verify"
        ? "If a pending sign-in exists, a code has been sent."
        : "If a pending registration exists, a verification code has been sent.");
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const isRegistration = mode === "register";
  const passwordMismatch = isRegistration &&
    Boolean(values.password && values.confirmPassword) &&
    values.password !== values.confirmPassword;
  const passwordsMatch = isRegistration &&
    Boolean(values.password && values.confirmPassword) &&
    values.password === values.confirmPassword;
  return <div className="auth-page">
    <div className="auth-visual"><Brand light/><div><div className="eyebrow">EARN SOMETHING. TEACH SOMETHING.</div><h1>Your next skill<br/>starts with a swap.</h1><p>Share what you know. Discover what you don't. Grow together, one session at a time.</p></div><small>Make learning a two-way street.</small></div>
    <div className="auth-panel"><div className="auth-card"><Brand/><span className="eyebrow">YOUR COMMUNITY AWAITS</span><h2>{mode === "login" ? "Welcome back" : mode === "register" ? "Create your account" : mode === "verify" ? "Verify your email" : mode === "login-verify" ? "Verify your sign-in" : mode === "forgot" ? "Reset your password" : "Choose a new password"}</h2><p className="muted">{mode === "verify" ? `Enter the six-digit code sent to ${email}` : mode === "login-verify" ? `Enter the six-digit sign-in code sent to ${email}` : isRegistration ? (emailOtpEnabled ? "Use any email address you can access. We’ll send your verification code there." : "Create an account with your email and a strong password. No verification email is sent.") : "Sign in to continue your learning journey."}</p>
      {!emailOtpEnabled && <small className="muted">Email verification and password recovery are unavailable. Use a unique password of at least 12 characters and keep it safe.</small>}
      <form onSubmit={submit}>
        {isRegistration && <label>Full name<input name="name" required minLength="2" maxLength="80" autoComplete="name" value={values.name || ""} onChange={input}/></label>}
        {(mode === "login" || isRegistration || mode === "forgot") && <label>Email address<input name="email" type="email" required autoComplete="email" value={values.email || ""} onChange={input}/></label>}
        {(mode === "verify" || mode === "login-verify") && <label>Six-digit {mode === "login-verify" ? "sign-in" : "verification"} code<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" required value={values.otp || ""} onChange={input}/></label>}
        {mode === "reset" && <><label>Reset token<input name="token" required value={values.token || ""} onChange={input}/></label><label>New password<input name="password" type="password" required minLength="8" value={values.password || ""} onChange={input}/></label></>}
        {(mode === "login" || isRegistration) && <label>Password<input name="password" type="password" required minLength={isRegistration ? (emailOtpEnabled ? 8 : 12) : 1} autoComplete={isRegistration ? "new-password" : "current-password"} value={values.password || ""} onChange={input}/></label>}
        {isRegistration && <label>Confirm password<input name="confirmPassword" type="password" required minLength={emailOtpEnabled ? 8 : 12} maxLength="128" autoComplete="new-password" aria-invalid={passwordMismatch} aria-describedby="confirm-password-feedback" value={values.confirmPassword || ""} onChange={input}/>{(passwordMismatch || passwordsMatch) && <small id="confirm-password-feedback" className={`auth-password-feedback ${passwordMismatch ? "mismatch" : "match"}`} aria-live="polite">{passwordMismatch ? "Passwords do not match." : "Passwords match."}</small>}</label>}
        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        <button className="button button-primary auth-submit" disabled={busy || passwordMismatch || !authConfigReady}>{busy ? "Please wait..." : mode === "login" ? (emailOtpEnabled ? "Continue to email verification" : "Sign in") : mode === "register" ? (emailOtpEnabled ? "Send verification code" : "Create account") : mode === "verify" ? "Verify email" : mode === "login-verify" ? "Verify and sign in" : mode === "forgot" ? "Send reset instructions" : "Reset password"}</button>
      </form>
      {(mode === "verify" || mode === "login-verify") && <button className="text-button" disabled={cooldown > 0} onClick={resend}>{cooldown ? `Resend code in ${cooldown}s` : "Resend code"}</button>}
      {mode === "login" && emailOtpEnabled && <button className="text-button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>Forgot password?</button>}
      {(mode === "login" || isRegistration) && <p className="switch-auth">{isRegistration ? "Already have an account?" : "New to Skill Swap?"}<button className="text-button" onClick={() => { setMode(isRegistration ? "login" : "register"); setError(""); setNotice(""); }}> {isRegistration ? "Sign in" : "Create an account"}</button></p>}
      {mode === "login-verify" && <p className="switch-auth"><button className="text-button" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>Use a different account</button></p>}
    </div></div>
  </div>;
}

function Loading({ label = "Loading..." }) {
  return <div className="phase-loading" role="status"><span className="loading-spinner"/>{label}</div>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="phase-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action}</div>;
}

function AppShell({ user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [["/dashboard", "Dashboard"], ["/categories", "Categories"], ["/my-skills", "My skills"], ["/tutors", "Find tutors"], ["/chat", "Messages"], ["/sessions", "My sessions"], ["/reviews", "My reviews"], ["/disputes", "My disputes"], ["/wallet", "Wallet"], ["/usage", "Usage & access"], ["/plans", "Upgrade plan"], ["/billing", "Billing"], ["/notifications", "Notifications"], ["/profile", "Profile"]];
  return <div className="phase-app">
    <header className="phase-topbar"><Brand/><div className="phase-top-actions"><span className="phase-credit">Credits <b>{user.creditBalance}</b></span><span className="phase-user">{user.name}</span><button className="phase-mobile-toggle" onClick={() => setMobileOpen(open => !open)} aria-label="Toggle navigation">{mobileOpen ? <X/> : <Menu/>}</button><button className="phase-icon-btn" onClick={onLogout} aria-label="Sign out"><LogOut size={18}/></button></div></header>
    <div className="phase-layout"><aside className={`phase-sidebar ${mobileOpen ? "open" : ""}`} aria-label="Application navigation">    {links.map(([to, label]) => new Set(["/reviews", "/disputes"]).has(to) && !user ? null : <NavLink to={to} key={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `phase-nav-link ${isActive ? "active" : ""}`}>{label}</NavLink>)}{user.accountType === "admin" && <><NavLink to="/admin" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Admin dashboard</NavLink><NavLink to="/admin/users" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> User management</NavLink><NavLink to="/admin/disputes" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Disputes</NavLink><NavLink to="/admin/audit" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Audit logs</NavLink><NavLink to="/admin/catalog" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Catalog admin</NavLink><NavLink to="/admin/settlements" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Settlement audit</NavLink><NavLink to="/admin/usage" className="phase-nav-link" onClick={() => setMobileOpen(false)}><ShieldCheck size={17}/> Usage admin</NavLink></>}</aside><main className="phase-main">{children}</main></div>
  </div>;
}

function Protected({ user, children }) {
  if (!user) return <Navigate to="/login" replace/>;
  return children;
}

function Dashboard({ user }) {
  return <><PageHeading eyebrow="YOUR LEARNING SPACE" title={`Welcome, ${user.name.split(" ")[0]}`} description="Build your profile, share what you know, and discover your next learning partner."/><div className="phase-dashboard-grid"><Link to="/profile" className="phase-action-card"><CircleUserRound/><b>Complete your profile</b><span>Tell the community about your experience and availability.</span><ArrowRight/></Link><Link to="/my-skills" className="phase-action-card"><BookOpen/><b>Add skills</b><span>Choose what you can teach and what you want to learn.</span><ArrowRight/></Link><Link to="/categories" className="phase-action-card"><Search/><b>Browse categories</b><span>Explore technical, academic, creative, and wellness skills.</span><ArrowRight/></Link><Link to="/tutors" className="phase-action-card"><Languages/><b>Find a tutor</b><span>Search real member profiles by subject and availability.</span><ArrowRight/></Link></div></>;
}

function ProfilePage({ onUserUpdated }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [slot, setSlot] = useState({ dayOfWeek: "1", startTime: "09:00", endTime: "10:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
  useEffect(() => {
    api.get("/users/me").then(response => {
      const user = response.data.data.user;
      setProfile(user);
      setForm({ ...user, languagesText: (user.languages || []).join(", "), interestsText: (user.interests || []).join(", ") });
    }).catch(requestError => setError(getMessage(requestError))).finally(() => setBusy(false));
  }, []);
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const save = async event => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const payload = {
      name: form.name,
      profileImage: form.profileImage || "",
      bio: form.bio || "",
      location: form.location || "",
      languages: (form.languagesText || "").split(",").map(value => value.trim()).filter(Boolean),
      interests: (form.interestsText || "").split(",").map(value => value.trim()).filter(Boolean),
      experienceLevel: form.experienceLevel,
      preferredLearningMode: form.preferredLearningMode,
      isProfilePublic: form.isProfilePublic,
      availableTimeSlots: form.availableTimeSlots || []
    };
    try {
      const response = await api.patch("/users/me", payload);
      setProfile(response.data.data.user);
      setForm(current => ({ ...current, ...response.data.data.user, languagesText: payload.languages.join(", "), interestsText: payload.interests.join(", ") }));
      onUserUpdated(response.data.data.user);
      setMessage("Profile saved.");
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setSaving(false); }
  };
  const addSlot = () => setForm(current => ({ ...current, availableTimeSlots: [...(current.availableTimeSlots || []), { ...slot, dayOfWeek: Number(slot.dayOfWeek) }] }));
  const removeSlot = index => setForm(current => ({ ...current, availableTimeSlots: current.availableTimeSlots.filter((_, slotIndex) => slotIndex !== index) }));
  if (busy) return <Loading label="Loading your profile..."/>;
  if (!profile) return <div className="phase-alert error">{error}</div>;
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return <><PageHeading eyebrow="YOUR PROFILE" title="Profile details" description="The more you share, the easier it is for a good learning match to find you."/><div className="phase-profile-grid"><form className="phase-panel phase-form" onSubmit={save}>
    <div className="phase-profile-intro"><span className="phase-avatar">{form.name?.[0]?.toUpperCase()}</span><div><h2>{form.name}</h2><p>{form.email}</p><div className="phase-progress"><span style={{ width: `${profile.profileCompletion?.percent || 0}%` }}/></div><small>{profile.profileCompletion?.percent || 0}% profile complete</small></div></div>
    <label>Full name<input name="name" required minLength="2" maxLength="80" value={form.name || ""} onChange={change}/></label>
    <label>Profile image URL<input name="profileImage" type="url" maxLength="2048" value={form.profileImage || ""} onChange={change} placeholder="https://..."/></label>
    <label>Bio and introduction<textarea name="bio" rows="4" maxLength="1000" value={form.bio || ""} onChange={change} placeholder="What do you enjoy teaching or learning?"/></label>
    <label>Location<input name="location" maxLength="120" value={form.location || ""} onChange={change} placeholder="City (optional)"/></label>
    <label>Languages spoken<input name="languagesText" value={form.languagesText || ""} onChange={change} placeholder="English, Telugu"/></label>
    <label>Interests<input name="interestsText" value={form.interestsText || ""} onChange={change} placeholder="Web development, music"/></label>
    <div className="phase-form-row"><label>Experience level<select name="experienceLevel" value={form.experienceLevel || "beginner"} onChange={change}>{["beginner", "intermediate", "advanced", "expert"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Preferred learning mode<select name="preferredLearningMode" value={form.preferredLearningMode || "either"} onChange={change}><option value="online">Online</option><option value="in-person">In person</option><option value="either">Either</option></select></label></div>
    <label className="phase-checkbox"><input name="isProfilePublic" type="checkbox" checked={form.isProfilePublic !== false} onChange={change}/> Show my profile in tutor search</label>
    <div className="phase-slots"><h3>Weekly availability</h3><div className="phase-form-row"><label>Day<select value={slot.dayOfWeek} onChange={event => setSlot({ ...slot, dayOfWeek: event.target.value })}>{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label><label>Timezone<input value={slot.timezone} maxLength="80" onChange={event => setSlot({ ...slot, timezone: event.target.value })}/></label></div><div className="phase-form-row"><label>From<input type="time" value={slot.startTime} onChange={event => setSlot({ ...slot, startTime: event.target.value })}/></label><label>Until<input type="time" value={slot.endTime} onChange={event => setSlot({ ...slot, endTime: event.target.value })}/></label></div><button type="button" className="button button-light" onClick={addSlot}>Add time slot</button>{(form.availableTimeSlots || []).map((item, index) => <div className="phase-slot-row" key={`${item.dayOfWeek}-${index}`}><span>{weekdays[item.dayOfWeek]} · {item.startTime}–{item.endTime} ({item.timezone})</span><button type="button" className="text-button" onClick={() => removeSlot(index)} aria-label={`Remove ${weekdays[item.dayOfWeek]} slot`}>Remove</button></div>)}</div>
    {error && <div className="phase-alert error">{error}</div>}{message && <div className="phase-alert success">{message}</div>}<button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
  </form><aside className="phase-panel phase-profile-aside"><h2>Skills and interests</h2><p>Your public profile never includes your email, permissions, or credit balance.</p><Link className="button button-primary" to="/my-skills">Manage my skills <ArrowRight size={16}/></Link><Link className="phase-inline-link" to="/tutors">Preview tutor search</Link></aside></div></>;
}

function MySkillsPage() {
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [skills, setSkills] = useState([]);
  const [mine, setMine] = useState({ skillsToTeach: [], skillsToLearn: [] });
  const [selectedSkill, setSelectedSkill] = useState("");
  const [direction, setDirection] = useState("skillsToTeach");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const category = categories.find(item => item._id === categoryId);
  const refresh = async () => {
    const response = await api.get("/users/me/skills");
    setMine(response.data.data);
  };
  useEffect(() => {
    Promise.all([api.get("/categories"), api.get("/users/me/skills")])
      .then(([categoryResponse, skillResponse]) => {
        setCategories(categoryResponse.data.data.categories);
        setMine(skillResponse.data.data);
      }).catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!category) { setSkills([]); return; }
    api.get(`/categories/${category.slug}/skills`).then(response => setSkills(response.data.data.skills)).catch(requestError => setError(getMessage(requestError)));
  }, [category]);
  const add = async event => {
    event.preventDefault(); setError(""); setNotice("");
    const skillId = selectedSkill;
    const teach = mine.skillsToTeach.map(skill => typeof skill === "object" ? skill._id : skill);
    const learn = mine.skillsToLearn.map(skill => typeof skill === "object" ? skill._id : skill);
    const destination = direction === "skillsToTeach" ? teach : learn;
    const opposite = direction === "skillsToTeach" ? learn : teach;
    const updatedDestination = [...new Set([...destination, skillId])];
    const updatedOpposite = opposite.filter(id => id !== skillId);
    try {
      await api.put("/users/me/skills", direction === "skillsToTeach"
        ? { skillsToTeach: updatedDestination, skillsToLearn: updatedOpposite }
        : { skillsToTeach: updatedOpposite, skillsToLearn: updatedDestination });
      await refresh();
      setNotice("Skill added to your profile.");
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const remove = async skillId => {
    try {
      await api.delete(`/users/me/skills/${skillId}`);
      await refresh();
      setNotice("Skill removed from your profile.");
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const skillsByCategory = useMemo(() => skills, [skills]);
  if (loading) return <Loading label="Loading skills..."/>;
  return <><PageHeading eyebrow="YOUR SKILL SET" title="Skills I teach and want to learn" description="Choose existing skills from the shared catalog. Don't see one? Send a suggestion for admin review."/><div className="phase-skills-layout"><section className="phase-panel"><h2>Add a skill to your profile</h2><form className="phase-form" onSubmit={add}><label>Category<select required value={categoryId} onChange={event => { setCategoryId(event.target.value); setSelectedSkill(""); }}><option value="">Choose category</option>{categories.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Skill<select required value={selectedSkill} onChange={event => setSelectedSkill(event.target.value)} disabled={!categoryId}><option value="">Choose skill</option>{skillsByCategory.map(skill => <option key={skill._id} value={skill._id}>{skill.name}</option>)}</select></label><label>Add this as<select value={direction} onChange={event => setDirection(event.target.value)}><option value="skillsToTeach">A skill I can teach</option><option value="skillsToLearn">A skill I want to learn</option></select></label><button className="button button-primary" disabled={!selectedSkill}>Add skill</button></form></section><section className="phase-panel"><div className="phase-skill-section"><h2>Skills I can teach <span>{mine.skillsToTeach.length}</span></h2>{mine.skillsToTeach.map(skill => <ProfileSkill key={skill._id} skill={skill} remove={remove}/>) }{!mine.skillsToTeach.length && <p className="phase-empty-small">No teaching skills yet. Add one from the catalog.</p>}</div><div className="phase-skill-section"><h2>Skills I want to learn <span>{mine.skillsToLearn.length}</span></h2>{mine.skillsToLearn.map(skill => <ProfileSkill key={skill._id} skill={skill} remove={remove}/>) }{!mine.skillsToLearn.length && <p className="phase-empty-small">No learning interests yet. Add a skill from the catalog.</p>}</div></section><SkillSuggestion categories={categories} onSubmitted={() => setNotice("Suggestion sent for admin review.")}/></div>{error && <div className="phase-alert error">{error}</div>}{notice && <div className="phase-alert success">{notice}</div>}</>;
}

function ProfileSkill({ skill, remove }) {
  return <div className="phase-skill-row"><span className="phase-skill-icon"><BookOpen size={17}/></span><span><b>{skill.name}</b><small>{skill.category?.name}</small></span><button className="phase-remove" onClick={() => remove(skill._id)}>Remove</button></div>;
}

function SkillSuggestion({ categories, onSubmitted }) {
  const [form, setForm] = useState({ name: "", category: "", description: "" });
  const [error, setError] = useState("");
  const submit = async event => {
    event.preventDefault(); setError("");
    try {
      await api.post("/skills/suggestions", form);
      setForm({ name: "", category: "", description: "" });
      onSubmitted();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  return <section className="phase-panel"><h2>Suggest a missing skill</h2><p className="muted">Suggestions are reviewed before they become part of the public skill catalog.</p><form className="phase-form" onSubmit={submit}><label>Skill name<input required minLength="2" maxLength="100" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Category<select required value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option value="">Choose category</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label><label>Why should it be added?<textarea rows="3" maxLength="1000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></label>{error && <div className="phase-alert error">{error}</div>}<button className="button button-light">Submit suggestion</button></form></section>;
}

function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/categories").then(response => setCategories(response.data.data.categories)).catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading label="Loading categories..."/>;
  return <><PageHeading eyebrow="EXPLORE AND LEARN" title="Browse categories" description="Find learning partners across technical, academic, creative, and wellness skills."/><div className="phase-category-grid">{categories.map(category => <Link to={`/categories/${category.slug}`} className="phase-category-card" key={category._id}><span className="phase-category-icon"><BookOpen/></span><h2>{category.name}</h2><p>{category.description || "Explore this learning category."}</p><span className="phase-inline-link">Explore skills <ArrowRight size={15}/></span></Link>)}</div>{!categories.length && !error && <div className="phase-empty">No active categories are available yet.</div>}{error && <div className="phase-alert error">{error}</div>}</>;
}

function CategoryPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    api.get(`/categories/${encodeURIComponent(slug)}/skills`).then(response => setData(response.data.data)).catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, [slug]);
  if (loading) return <Loading label="Loading category..."/>;
  if (error) return <div className="phase-alert error">{error}</div>;
  return <><Link className="phase-back-link" to="/categories"><ArrowLeft size={16}/> All categories</Link><PageHeading eyebrow="CATEGORY" title={data.category.name} description={data.category.description}/><div className="phase-subject-grid">{data.skills.map(skill => <Link key={skill._id} to={`/tutors?category=${encodeURIComponent(data.category.slug)}&skill=${encodeURIComponent(skill.slug)}`} className="phase-subject-card"><span>{skill.name}</span><ArrowRight size={16}/></Link>)}</div>{!data.skills.length && <div className="phase-empty">No active skills have been added to this category yet.</div>}</>;
}

function TutorSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [skills, setSkills] = useState([]);
  const [filters, setFilters] = useState({
    q: searchParams.get("name") || "",
    category: searchParams.get("category") || "",
    skill: searchParams.get("skill") || "",
    experience: "",
    language: "",
    mode: "",
    dayOfWeek: "",
    minRating: "",
    sort: "newest"
  });
  const [results, setResults] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, pages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileFilters, setMobileFilters] = useState(false);
  useEffect(() => {
    api.get("/categories").then(response => setCategories(response.data.data.categories)).catch(requestError => setError(getMessage(requestError)));
  }, []);
  const currentCategory = categories.find(category => category.slug === filters.category || category._id === filters.category);
  useEffect(() => {
    if (!currentCategory) { setSkills([]); return; }
    api.get(`/categories/${encodeURIComponent(currentCategory.slug)}/skills`).then(response => setSkills(response.data.data.skills)).catch(requestError => setError(getMessage(requestError)));
  }, [currentCategory]);
  const runSearch = async (nextPage = 1) => {
    setLoading(true); setError(""); setPage(nextPage);
    const query = Object.fromEntries(Object.entries({ ...filters, page: nextPage, limit: 12 }).filter(([, value]) => value !== "" && value !== undefined));
    try {
      const response = await api.get("/tutors/search", { params: query, headers: { "Idempotency-Key": idempotencyKey("tutor-search") } });
      setResults(response.data.data.tutors);
      setPagination(response.data.data.pagination);
      setSearchParams(query);
    } catch (requestError) { setError(requestError); setResults([]); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (categories.length) runSearch(1);
  }, [categories.length]);
  const update = event => {
    const { name, value } = event.target;
    setFilters(current => ({ ...current, [name]: value, ...(name === "category" ? { skill: "" } : {}) }));
  };
  const dayOptions = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return <><PageHeading eyebrow="FIND A LEARNING PARTNER" title="Search tutors" description="Search verified community profiles by skill, experience, and availability." action={<button className="phase-filter-toggle" onClick={() => setMobileFilters(open => !open)}><Menu size={16}/> Filters</button>}/><div className="phase-tutor-layout">
    <aside className={`phase-panel phase-filters ${mobileFilters ? "visible" : ""}`}><h2>Filters</h2><form onSubmit={event => { event.preventDefault(); runSearch(1); }}>
      <label>Tutor name<input name="q" maxLength="80" value={filters.q} onChange={update} placeholder="Search by name"/></label>
      <label>Category<select name="category" value={currentCategory?._id || ""} onChange={update}><option value="">All categories</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label>
      <label>Skill or subject<select name="skill" value={filters.skill} onChange={update}><option value="">Any skill</option>{skills.map(skill => <option key={skill._id} value={skill.slug}>{skill.name}</option>)}</select></label>
      <label>Experience<select name="experience" value={filters.experience} onChange={update}><option value="">Any level</option>{["beginner", "intermediate", "advanced", "expert"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Language<input name="language" maxLength="60" value={filters.language} onChange={update} placeholder="English"/></label>
      <label>Learning mode<select name="mode" value={filters.mode} onChange={update}><option value="">Any mode</option><option value="online">Online</option><option value="in-person">In person</option></select></label>
      <label>Available on<select name="dayOfWeek" value={filters.dayOfWeek} onChange={update}><option value="">Any day</option>{dayOptions.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
      <label>Minimum review rating<select name="minRating" value={filters.minRating} onChange={update}><option value="">Any rating</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}+ stars</option>)}</select></label>
      <label>Sort by<select name="sort" value={filters.sort} onChange={update}><option value="newest">Recently active</option><option value="name">Name</option><option value="rating">Highest rated</option></select></label>
      <button className="button button-primary">Search tutors</button>
    </form></aside>
    <section className="phase-tutor-results"><div className="phase-results-head"><h2>{loading ? "Searching..." : `${pagination.total} tutor${pagination.total === 1 ? "" : "s"} found`}</h2><span>Page {pagination.page} of {Math.max(1, pagination.pages)}</span></div>
      {error && <RestrictedActionNotice error={error}/>}
      {loading ? <div className="phase-result-skeletons"><span/><span/><span/></div> : results.map(result => <TutorCard key={result.user._id} result={result}/>)}
      {!loading && !error && !results.length && <div className="phase-empty"><Search size={23}/><h3>No tutors match these filters</h3><p>Try a different skill, category, or availability filter.</p><button className="text-button" onClick={() => { setFilters({ q: "", category: "", skill: "", experience: "", language: "", mode: "", dayOfWeek: "", minRating: "", sort: "newest" }); }}>Clear filters</button></div>}
      {!loading && pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={page <= 1} onClick={() => runSearch(page - 1)}><ChevronLeft size={16}/>Previous</button><span>Page {page} of {pagination.pages}</span><button className="button button-light" disabled={page >= pagination.pages} onClick={() => runSearch(page + 1)}>Next<ChevronRight size={16}/></button></div>}
    </section>
  </div></>;
}

function TutorCard({ result }) {
  const { user, rating } = result;
  const [searchParams] = useSearchParams();
  const selected = user.skillsToTeach?.find(skill => skill.slug === searchParams.get("skill")) || user.skillsToTeach?.[0];
  return <article className="phase-tutor-card"><span className="phase-avatar">{user.profileImage ? <img src={user.profileImage} alt=""/> : user.name?.[0]?.toUpperCase()}</span><div className="phase-tutor-card-main"><Link to={`/tutors/${user._id}`}><h3>{user.name}</h3></Link><p>{user.bio || "Community member ready to share what they know."}</p><div className="phase-tutor-meta"><span>{user.experienceLevel}</span><span>{user.preferredLearningMode === "either" ? "Online or in person" : user.preferredLearningMode}</span>{rating && <span>★ {rating.average} ({rating.count})</span>}</div><div className="phase-tutor-tags">{user.skillsToTeach?.slice(0, 5).map(skill => <span key={skill._id}>{skill.name}</span>)}</div><ConnectAction tutor={user} skills={user.skillsToTeach || []} preferredSkill={selected?._id}/></div><Link className="button button-light phase-view-profile" to={`/tutors/${user._id}`}>View profile</Link></article>;
}

function ConnectAction({ tutor, skills, preferredSkill }) {
  const [skillId, setSkillId] = useState(preferredSkill || skills[0]?._id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    if (preferredSkill && skills.some(skill => String(skill._id) === String(preferredSkill))) setSkillId(preferredSkill);
    else if (!skills.some(skill => String(skill._id) === String(skillId))) setSkillId(skills[0]?._id || "");
  }, [preferredSkill, skills, skillId]);
  const connect = async () => {
    if (!skillId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await api.post("/connections", { tutorId: tutor._id, skillId }, {
        headers: { "Idempotency-Key": idempotencyKey("connection") }
      });
      navigate(`/chat/${response.data.data.conversationId}`);
    } catch (requestError) { setError(requestError); }
    finally { setBusy(false); }
  };
  return <div className="phase-connect-action">{skills.length > 1 && <label className="sr-only" htmlFor={`connect-skill-${tutor._id}`}>Select a subject</label>}{skills.length > 1 && <select id={`connect-skill-${tutor._id}`} value={skillId} onChange={event => setSkillId(event.target.value)} aria-label={`Subject to learn from ${tutor.name}`}>{skills.map(skill => <option key={skill._id} value={skill._id}>{skill.name}</option>)}</select>}<button className="button button-primary" disabled={!skillId || busy} onClick={connect}><MessageCircle size={15}/>{busy ? "Connecting..." : "Connect"}</button>{error && <RestrictedActionNotice error={error} onDismiss={() => setError("")}/>}</div>;
}

function TutorProfilePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    api.get(`/tutors/${encodeURIComponent(id)}`).then(response => setData(response.data.data)).catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, [id]);
  if (loading) return <Loading label="Loading tutor profile..."/>;
  if (error) return <div className="phase-alert error">{error}</div>;
  const tutor = data.tutor;
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return <><Link to="/tutors" className="phase-back-link"><ArrowLeft size={16}/> Back to tutor search</Link><section className="phase-panel phase-public-profile"><div className="phase-public-head"><span className="phase-avatar phase-avatar-xl">{tutor.profileImage ? <img src={tutor.profileImage} alt=""/> : tutor.name?.[0]?.toUpperCase()}</span><div><div className="eyebrow">SKILL SWAP MEMBER</div><h1>{tutor.name}</h1><p>{tutor.location || "Location not specified"} · {tutor.preferredLearningMode === "either" ? "Online or in person" : tutor.preferredLearningMode}</p>{data.rating && <strong className="phase-rating">★ {data.rating.average} · {data.rating.count} review{data.rating.count === 1 ? "" : "s"}</strong>}</div><ConnectAction tutor={tutor} skills={tutor.skillsToTeach || []}/></div><section><h2>About</h2><p>{tutor.bio || "This member has not added an introduction yet."}</p></section><section><h2>Skills they teach</h2><div className="phase-tutor-tags">{tutor.skillsToTeach?.map(skill => <span key={skill._id}>{skill.name}{skill.category?.name ? ` · ${skill.category.name}` : ""}</span>)}</div>{!tutor.skillsToTeach?.length && <p>No teaching skills listed.</p>}</section><section><h2>Skills they want to learn</h2><div className="phase-tutor-tags">{tutor.skillsToLearn?.map(skill => <span key={skill._id}>{skill.name}</span>)}</div>{!tutor.skillsToLearn?.length && <p>No learning interests listed.</p>}</section><section className="phase-public-info"><div><h2>Experience</h2><p>{tutor.experienceLevel}</p></div><div><h2>Languages</h2><p>{tutor.languages?.join(", ") || "Not specified"}</p></div><div><h2>Interests</h2><p>{tutor.interests?.join(", ") || "Not specified"}</p></div></section><section><h2>Availability</h2>{tutor.availableTimeSlots?.length ? tutor.availableTimeSlots.map((slot, index) => <p key={`${slot.dayOfWeek}-${index}`}>{weekdays[slot.dayOfWeek]} · {slot.startTime}–{slot.endTime} ({slot.timezone})</p>) : <p>No availability listed.</p>}</section><section><h2>Reviews</h2>{data.reviews.map(review => <article className="phase-review" key={review._id}><b>{review.author?.name || "Community member"} · ★ {review.rating}</b><p>{review.text || "No written review."}</p><small>{new Date(review.createdAt).toLocaleDateString()}</small></article>)}{!data.reviews.length && <p>No reviews yet.</p>}</section></section></>;
}

function sessionWhen(session) {
  const timezone = session.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", timeZone: timezone
    }).format(new Date(session.startsAt));
  } catch {
    return new Date(session.startsAt).toLocaleString();
  }
}

function SessionCard({ session, userId, onAction, busy, reviewed = false, onReview }) {
  const isLearner = String(session.learner?._id || session.learner) === String(userId);
  const isParticipant = isLearner || String(session.tutor?._id || session.tutor) === String(userId);
  const proposal = session.rescheduleProposal;
  const canRespondReschedule = proposal?.status === "pending" && String(proposal.proposedBy?._id || proposal.proposedBy) !== String(userId);
  return <article className="phase-session-card">
    <div className="phase-session-heading"><div><div className="eyebrow">{session.category?.name || "LEARNING SESSION"}</div><Link to={`/sessions/${session._id}`}><h3>{session.title}</h3></Link></div><span className={`phase-session-status ${session.status}`}>{session.status}</span></div>
    <p className="phase-session-skill">{session.skill?.name || "Selected skill"} · {session.format === "online" ? "Online" : "In person"} · {session.durationMinutes} min</p>
    <div className="phase-session-settlement"><span>{session.creditPrice || session.settlement?.pricePerLearner || 10} credits per learner</span><b>{session.settlement?.status || "not_started"}</b></div>
    {session.myCreditHistory && <div className="phase-session-ledger">From your ledger: {session.myCreditHistory.charged > 0 ? `${session.myCreditHistory.charged} credits charged` : ""}{session.myCreditHistory.charged > 0 && session.myCreditHistory.earned > 0 ? " · " : ""}{session.myCreditHistory.earned > 0 ? `${session.myCreditHistory.earned} credits earned` : ""}{!session.myCreditHistory.charged && !session.myCreditHistory.earned ? "No credit transfer recorded" : ""}</div>}
    <div className="phase-session-details"><span><CalendarDays size={14}/>{sessionWhen(session)}</span><span>{isLearner ? "Tutor" : "Learner"}: {isLearner ? session.tutor?.name : session.learner?.name}</span></div>
    {session.description && <p className="phase-session-notes">{session.description}</p>}
    {session.format === "online" && session.meetingDetails && <p className="phase-session-notes">Meeting: {session.meetingDetails}</p>}
    {session.format === "in-person" && session.location && <p className="phase-session-notes">Location: {session.location}</p>}
    {proposal?.status === "pending" && <div className="phase-session-reschedule" role="status"><b>Time change awaiting confirmation</b><span>{sessionWhen({ ...session, startsAt: proposal.startsAt, timezone: proposal.timezone })}</span>{canRespondReschedule && <div><button type="button" className="button button-primary" disabled={busy} onClick={() => onAction(session._id, "reschedule/accept")}>Confirm new time</button><button type="button" className="button button-light" disabled={busy} onClick={() => onAction(session._id, "reschedule/reject")}>Decline change</button></div>}</div>}
    {onAction && isParticipant && <div className="phase-session-actions">
      {session.status === "pending" && isLearner && <><button type="button" className="button button-primary" disabled={busy} onClick={() => onAction(session._id, "accept")}>Accept</button><button type="button" className="button button-light" disabled={busy} onClick={() => onAction(session._id, "reject")}>Decline</button></>}
      {session.status === "scheduled" && <button type="button" className="button button-light" disabled={busy} onClick={() => onAction(session._id, "reschedule-form")}>Propose new time</button>}
      {["pending", "scheduled"].includes(session.status) && <button type="button" className="button button-light" disabled={busy} onClick={() => onAction(session._id, "cancel")}>Cancel session</button>}
      {onReview && isLearner && session.status === "completed" && session.completion?.learnerConfirmedAt && !reviewed && <button type="button" className="button button-light" disabled={busy} onClick={() => onReview(session)}>Review tutor</button>}
      {onReview && isLearner && session.status === "completed" && reviewed && <span className="phase-reviewed-label">Tutor reviewed</span>}
    </div>}
  </article>;
}

function localDateTimeFields(instant, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant))
    .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    startTime: `${values.hour}:${values.minute}`
  };
}

function localInputValue(instant) {
  const date = new Date(instant);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function SessionBookingForm({ conversationId, skill, tutorName, learnerName, onClose, onCreated }) {
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [form, setForm] = useState({
    title: skill?.name ? `${skill.name} learning session` : "",
    date: "", startTime: "", timezone: defaultZone, durationMinutes: "30",
    format: "online", meetingDetails: "", location: "", description: ""
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (!conversationId || !skill?._id) return setError("This conversation does not have a valid skill.");
    setSaving(true);
    setError("");
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await api.post("/sessions", {
        ...form, durationMinutes: Number(form.durationMinutes),
        conversationId, skillId: skill._id, idempotencyKey
      }, { headers: { "Idempotency-Key": idempotencyKey } });
      onCreated(response.data.data.session);
      onClose();
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setSaving(false);
    }
  };
  return <div className="phase-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="phase-panel phase-booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <div className="phase-booking-head"><div><div className="eyebrow">PROPOSE A SESSION</div><h2 id="booking-title">Schedule learning time</h2><p>{tutorName} · tutor · {learnerName} · learner</p></div><button type="button" className="phase-icon-btn" onClick={onClose} aria-label="Close booking form"><X size={17}/></button></div>
      <form className="phase-form phase-booking-form" onSubmit={submit}>
        <label>Skill or subject<input value={skill?.name || ""} readOnly/></label>
        <label>Session title<input name="title" required minLength="3" maxLength="160" value={form.title} onChange={change}/></label>
        <div className="phase-form-row"><label>Date<input name="date" type="date" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={change}/></label><label>Start time<input name="startTime" type="time" required value={form.startTime} onChange={change}/></label></div>
        <div className="phase-form-row"><label>Timezone (IANA)<input name="timezone" required maxLength="80" value={form.timezone} onChange={change} placeholder="Asia/Kolkata"/></label><label>Duration<select name="durationMinutes" value={form.durationMinutes} onChange={change}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label></div>
        <label>Session mode<select name="format" value={form.format} onChange={change}><option value="online">Online</option><option value="in-person">In person</option></select></label>
        {form.format === "online" ? <label>Meeting link or details (optional)<input name="meetingDetails" maxLength="1000" value={form.meetingDetails} onChange={change}/></label> : <label>Meeting location (optional)<input name="location" maxLength="300" value={form.location} onChange={change}/></label>}
        <label>Learning objectives or notes<textarea name="description" rows="3" maxLength="2000" value={form.description} onChange={change}/></label>
        {error && <div className="phase-alert error" role="alert">{error}</div>}
        <div className="phase-session-actions"><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Sending proposal..." : "Send proposal"}</button></div>
      </form>
    </section>
  </div>;
}

function RescheduleForm({ session, onClose, onSaved }) {
  const local = localDateTimeFields(session.startsAt, session.timezone || "UTC");
  const [form, setForm] = useState({
    ...local, timezone: session.timezone || "UTC", durationMinutes: String(session.durationMinutes)
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const key = globalThis.crypto?.randomUUID?.() || `reschedule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await api.patch(`/sessions/${session._id}/reschedule`, {
        ...form, durationMinutes: Number(form.durationMinutes), idempotencyKey: key
      }, { headers: { "Idempotency-Key": key } });
      onSaved(response.data.data.session);
      onClose();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setSaving(false); }
  };
  return <div className="phase-modal-backdrop"><section className="phase-panel phase-booking-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
    <div className="phase-booking-head"><div><div className="eyebrow">MUTUAL CONFIRMATION</div><h2 id="reschedule-title">Propose a new time</h2><p>The current confirmed time remains unchanged until the other participant agrees.</p></div><button type="button" className="phase-icon-btn" onClick={onClose} aria-label="Close reschedule form"><X size={17}/></button></div>
    <form className="phase-form phase-booking-form" onSubmit={submit}>
      <div className="phase-form-row"><label>Date<input type="date" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))}/></label><label>Start time<input type="time" required value={form.startTime} onChange={event => setForm(current => ({ ...current, startTime: event.target.value }))}/></label></div>
      <div className="phase-form-row"><label>Timezone<input required maxLength="80" value={form.timezone} onChange={event => setForm(current => ({ ...current, timezone: event.target.value }))}/></label><label>Duration<select value={form.durationMinutes} onChange={event => setForm(current => ({ ...current, durationMinutes: event.target.value }))}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label></div>
      {error && <div className="phase-alert error" role="alert">{error}</div>}
      <div className="phase-session-actions"><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Sending..." : "Send new-time proposal"}</button></div>
    </form>
  </section></div>;
}

function MySessionsPage({ user }) {
  const [sessions, setSessions] = useState([]);
  const [availability, setAvailability] = useState({ availableTimeSlots: [], unavailableTimeRanges: [] });
  const [filters, setFilters] = useState({ period: "upcoming", status: "", role: "all" });
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelTarget, setCancelTarget] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarSessions, setCalendarSessions] = useState([]);
  const [reviewedSessions, setReviewedSessions] = useState([]);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, text: "" });
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [list, availabilityResponse, reviewsResponse] = await Promise.all([
        api.get("/sessions", { params: { ...filters, page: pagination.page } }),
        api.get("/sessions/availability"),
        api.get("/reviews/me", { params: { limit: 50 } })
      ]);
      setSessions(list.data.data.sessions);
      setPagination(list.data.data.pagination);
      setAvailability(availabilityResponse.data.data);
      setReviewedSessions(reviewsResponse.data.data.reviews.map(review => String(review.session?._id || review.session)));
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [filters]);
  useEffect(() => {
    api.get("/categories").then(response => setCategories(response.data.data.categories))
      .catch(requestError => setError(getMessage(requestError)));
  }, []);
  useEffect(() => { load(); }, [pagination.page]);
  useEffect(() => {
    const from = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const to = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    api.get("/sessions/calendar", { params: { from: from.toISOString(), to: to.toISOString() } })
      .then(response => setCalendarSessions(response.data.data.sessions))
      .catch(requestError => setError(getMessage(requestError)));
  }, [calendarMonth, sessions]);
  const action = async (id, name) => {
    if (name === "reschedule-form") {
      setRescheduleTarget(sessions.find(item => String(item._id) === String(id)));
      return;
    }
    if (name === "cancel") { setCancelTarget(id); setCancelReason(""); return; }
    if (name.startsWith("reschedule/")) {
      try {
        const response = await api.patch(`/sessions/${id}/${name}`);
        setSessions(items => items.map(item => item._id === id ? response.data.data.session : item));
        setNotice("Reschedule response saved.");
      } catch (requestError) { setError(getMessage(requestError)); }
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.patch(`/sessions/${id}/${name}`);
      setSessions(items => items.map(item => item._id === id ? response.data.data.session : item));
      setNotice(name === "accept" ? "Session confirmed." : "Proposal declined.");
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const confirmCancel = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await api.patch(`/sessions/${cancelTarget}/cancel`, { reason: cancelReason });
      setSessions(items => items.map(item => item._id === cancelTarget ? response.data.data.session : item));
      setNotice("Session cancelled."); setCancelTarget("");
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const updateAvailability = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.put("/sessions/availability", availability);
      setAvailability(response.data.data);
      setNotice("Availability updated.");
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const submitReview = async event => {
    event.preventDefault();
    if (!reviewTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post("/reviews", { sessionId: reviewTarget._id, rating: Number(reviewForm.rating), text: reviewForm.text });
      setReviewedSessions(current => [...current, String(reviewTarget._id)]);
      setReviewTarget(null);
      setReviewForm({ rating: 5, text: "" });
      setNotice("Your review was submitted.");
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const addSlot = () => setAvailability(current => ({
    ...current, availableTimeSlots: [...current.availableTimeSlots, {
      dayOfWeek: 1, startTime: "09:00", endTime: "12:00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    }]
  }));
  const changeSlot = (index, field, value) => setAvailability(current => ({
    ...current, availableTimeSlots: current.availableTimeSlots.map((slot, i) => i === index ? {
      ...slot, [field]: field === "dayOfWeek" ? Number(value) : value
    } : slot)
  }));
  const removeSlot = index => setAvailability(current => ({
    ...current, availableTimeSlots: current.availableTimeSlots.filter((_, i) => i !== index)
  }));
  const addUnavailable = () => setAvailability(current => ({
    ...current, unavailableTimeRanges: [...current.unavailableTimeRanges, {
      startsAt: "", endsAt: "", reason: ""
    }]
  }));
  const changeUnavailable = (index, field, value) => setAvailability(current => ({
    ...current, unavailableTimeRanges: current.unavailableTimeRanges.map((range, i) => i === index ? {
      ...range, [field]: value
    } : range)
  }));
  const removeUnavailable = index => setAvailability(current => ({
    ...current, unavailableTimeRanges: current.unavailableTimeRanges.filter((_, i) => i !== index)
  }));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
  const calendarDays = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  return <>
    <PageHeading eyebrow="YOUR LEARNING TIME" title="My sessions" description="Review your session history, credit activity, and weekly availability." action={<Link className="button button-light" to="/reviews">Review history</Link>}/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}{notice && <div className="phase-alert success" role="status">{notice}</div>}
    <section className="phase-panel phase-session-filters">
      <label>Time<select value={filters.period} onChange={event => setFilters(current => ({ ...current, period: event.target.value }))}><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All</option></select></label>
      <label>Status<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">All statuses</option>{["pending", "scheduled", "rejected", "cancelled", "completed", "disputed"].map(status => <option key={status}>{status}</option>)}</select></label>
      <label>My role<select value={filters.role} onChange={event => setFilters(current => ({ ...current, role: event.target.value }))}><option value="all">All</option><option value="tutor">Tutor</option><option value="learner">Learner</option></select></label>
      <label>Category<select value={filters.category || ""} onChange={event => setFilters(current => ({ ...current, category: event.target.value }))}><option value="">All categories</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label>
    </section>
    <div className="phase-sessions-grid"><section><h2>Bookings</h2>{loading ? <Loading label="Loading sessions..."/> : sessions.map(session => <SessionCard key={session._id} session={session} userId={user.id || user._id} onAction={action} busy={busy} reviewed={reviewedSessions.includes(String(session._id))} onReview={setReviewTarget}/>)}
      {!loading && !sessions.length && <div className="phase-empty"><CalendarDays size={24}/><h3>No sessions found</h3><p>Proposed or confirmed sessions will appear here.</p></div>}
      {!loading && pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={pagination.page <= 1} onClick={() => setPagination(current => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="button button-light" disabled={pagination.page >= pagination.pages} onClick={() => setPagination(current => ({ ...current, page: current.page + 1 }))}>Next</button></div>}
    </section><section className="phase-panel phase-calendar"><div className="phase-calendar-heading"><button className="button button-light" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button><h2>{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><button className="button button-light" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button></div><div className="phase-calendar-grid">{days.map(day => <b key={day}>{day.slice(0, 2)}</b>)}{Array.from({ length: calendarStart }, (_, index) => <i key={`blank-${index}`}/>)}{Array.from({ length: calendarDays }, (_, index) => {
      const day = index + 1;
      const daySessions = calendarSessions.filter(item => {
        const date = new Date(item.startsAt);
        return date.getFullYear() === calendarMonth.getFullYear() && date.getMonth() === calendarMonth.getMonth() && date.getDate() === day;
      });
      return <div key={day} className={daySessions.length ? "has-session" : ""} title={daySessions.map(item => item.title).join(", ")}><span>{day}</span>{daySessions.length > 0 && <i>{daySessions.length}</i>}</div>;
    })}</div>{calendarSessions.map(item => <div className="phase-calendar-event" key={item._id}><b>{sessionWhen(item)}</b><span>{item.skill?.name} · {item.status}</span></div>)}</section></div>
    <section className="phase-panel phase-availability"><div className="phase-availability-head"><div><div className="eyebrow">PRIVATE TO YOU</div><h2>Your availability</h2><p className="muted">Weekly time windows and unavailable periods are only used to validate bookings.</p></div><button type="button" className="button button-light" onClick={addSlot}>Add weekly window</button></div>
      <form className="phase-form" onSubmit={updateAvailability}><div className="phase-availability-list">{availability.availableTimeSlots.map((slot, index) => <div className="phase-availability-row" key={`slot-${index}`}><select aria-label="Weekday" value={slot.dayOfWeek} onChange={event => changeSlot(index, "dayOfWeek", event.target.value)}>{days.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}</select><input aria-label="Available from" type="time" value={slot.startTime} onChange={event => changeSlot(index, "startTime", event.target.value)}/><input aria-label="Available until" type="time" value={slot.endTime} onChange={event => changeSlot(index, "endTime", event.target.value)}/><input aria-label="Timezone" value={slot.timezone} onChange={event => changeSlot(index, "timezone", event.target.value)}/><button type="button" className="text-button" onClick={() => removeSlot(index)}>Remove</button></div>)}</div>
        {!availability.availableTimeSlots.length && <p className="muted">Add weekly windows before accepting session proposals.</p>}
        <div className="phase-availability-head"><h3>Temporary time off</h3><button type="button" className="button button-light" onClick={addUnavailable}>Add time off</button></div>
        {availability.unavailableTimeRanges.map((range, index) => <div className="phase-availability-row" key={`off-${index}`}><label>From<input type="datetime-local" required value={range.startsAt ? localInputValue(range.startsAt) : ""} onChange={event => changeUnavailable(index, "startsAt", event.target.value && !Number.isNaN(Date.parse(event.target.value)) ? new Date(event.target.value).toISOString() : "")}/></label><label>Until<input type="datetime-local" required value={range.endsAt ? localInputValue(range.endsAt) : ""} onChange={event => changeUnavailable(index, "endsAt", event.target.value && !Number.isNaN(Date.parse(event.target.value)) ? new Date(event.target.value).toISOString() : "")}/></label><input aria-label="Reason for time off" placeholder="Optional reason" value={range.reason || ""} onChange={event => changeUnavailable(index, "reason", event.target.value)}/><button type="button" className="text-button" onClick={() => removeUnavailable(index)}>Remove</button></div>)}
        <button className="button button-primary" disabled={busy}>{busy ? "Saving..." : "Save availability"}</button>
      </form>
    </section>
    {cancelTarget && <div className="phase-modal-backdrop"><form className="phase-panel phase-cancel-modal phase-form" onSubmit={confirmCancel}><h2>Cancel this session?</h2><label>Reason<textarea required minLength="3" maxLength="500" value={cancelReason} onChange={event => setCancelReason(event.target.value)}/></label><div className="phase-session-actions"><button type="button" className="button button-light" onClick={() => setCancelTarget("")}>Keep session</button><button className="button button-primary" disabled={busy}>Confirm cancellation</button></div></form></div>}
    {reviewTarget && <div className="phase-modal-backdrop"><form className="phase-panel phase-review-modal" onSubmit={submitReview}><div className="phase-availability-head"><div><div className="eyebrow">COMPLETED SESSION</div><h2>Review {reviewTarget.tutor?.name || "your tutor"}</h2></div><button type="button" className="text-button" onClick={() => setReviewTarget(null)}>Close</button></div><label>Rating<select required value={reviewForm.rating} onChange={event => setReviewForm(current => ({ ...current, rating: event.target.value }))}>{[5, 4, 3, 2, 1].map(star => <option key={star} value={star}>{star} star{star > 1 ? "s" : ""}</option>)}</select></label><label>Feedback<textarea rows="4" maxLength="1500" placeholder="What was helpful about the session?" value={reviewForm.text} onChange={event => setReviewForm(current => ({ ...current, text: event.target.value }))}/></label><button className="button button-primary" disabled={busy}>{busy ? "Submitting..." : "Submit review"}</button></form></div>}
    {rescheduleTarget && <RescheduleForm session={rescheduleTarget} onClose={() => setRescheduleTarget(null)} onSaved={session => {
      setSessions(items => items.map(item => item._id === session._id ? session : item));
      setNotice("New-time proposal sent for confirmation.");
    }}/>}
  </>;
}

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.get("/notifications").then(response => setNotifications(response.data.data.notifications))
    .catch(requestError => setError(getMessage(requestError)));
  useEffect(() => { load(); }, []);
  const markRead = async id => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(items => items.map(item => item._id === id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const markAllRead = async () => {
    try {
      await api.patch("/notifications/read-all");
      setNotifications(items => items.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  return <><PageHeading eyebrow="UPDATES" title="Notifications" description="Your connection and session updates stay here, including while you are offline." action={<button type="button" className="button button-light" onClick={markAllRead}>Mark all read</button>}/>
    {error && <div className="phase-alert error">{error}</div>}
    <section className="phase-panel">{notifications.map(item => <article className={`phase-notification ${item.readAt ? "" : "unread"}`} key={item._id}><span className={`phase-notification-icon ${item.type.startsWith("session") ? "session" : ""}`}><CalendarDays size={17}/></span><div><b>{item.message}</b><small>{new Date(item.createdAt).toLocaleString()} · {item.readAt ? "Read" : "Unread"}</small></div>{item.resourceType === "session" && <Link className="button button-light" to="/sessions">View sessions</Link>}{item.resourceType === "dispute" && <Link className="button button-light" to="/disputes">View disputes</Link>}{item.resourceType === "review" && <Link className="button button-light" to="/reviews">View reviews</Link>}{!item.readAt && <button className="text-button" onClick={() => markRead(item._id)}>Mark read</button>}</article>)}{!error && !notifications.length && <div className="phase-empty"><h3>You're all caught up</h3><p>New session and connection updates will appear here.</p></div>}</section>
  </>;
}

function SessionDetailsPage({ user, onBalance }) {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [generalDisputeOpen, setGeneralDisputeOpen] = useState(false);
  const [generalDispute, setGeneralDispute] = useState({ reason: "", description: "" });
  const refresh = async () => {
    const [sessionResponse, completionResponse, walletResponse] = await Promise.all([
      api.get(`/sessions/${encodeURIComponent(id)}`),
      api.get(`/sessions/${encodeURIComponent(id)}/completion`),
      api.get("/wallet")
    ]);
    setSession(sessionResponse.data.data.session);
    setCompletion(completionResponse.data.data.completion);
    onBalance?.(walletResponse.data.data.balance);
  };
  useEffect(() => {
    Promise.all([
      api.get(`/sessions/${encodeURIComponent(id)}`),
      api.get(`/sessions/${encodeURIComponent(id)}/completion`)
    ]).then(([sessionResponse, completionResponse]) => {
      setSession(sessionResponse.data.data.session);
      setCompletion(completionResponse.data.data.completion);
    })
      .catch(requestError => setError(getMessage(requestError)))
      .finally(() => setLoading(false));
  }, [id]);
  const completeAction = async (action, body = {}) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const key = `settle:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      const response = await api.post(`/sessions/${id}/${action}`, {
        ...body,
        ...(action === "confirm-completion" || action === "settle" ? { idempotencyKey: key } : {})
      }, { headers: action === "confirm-completion" || action === "settle" ? { "Idempotency-Key": key } : {} });
      const data = response.data.data;
      if (data.session) setSession(data.session);
      setNotice(response.data.message);
      if (action === "dispute") setDisputeReason("");
      await refresh();
    } catch (requestError) {
      setError(getMessage(requestError));
      try { await refresh(); } catch {}
    } finally { setBusy(false); }
  };
  const submitDispute = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api.post("/disputes", { sessionId: id, ...generalDispute });
      setGeneralDisputeOpen(false);
      setGeneralDispute({ reason: "", description: "" });
      setNotice("Dispute opened. No credits were transferred.");
      await refresh();
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally { setBusy(false); }
  };
  if (loading) return <Loading label="Loading session..."/>;
  return <><PageHeading eyebrow="SESSION DETAILS" title={session?.title || "Session"} description="Booking details are visible only to the tutor and learner." action={<Link className="button button-light" to="/sessions">Back to my sessions</Link>}/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {session && <div className="phase-session-detail-grid"><SessionCard session={session} userId={user.id || user._id}/>
      <section className="phase-panel"><h2>Participants</h2><p><b>Tutor:</b> {session.tutor?.name}</p><p><b>Learner:</b> {session.learner?.name}</p><p><b>Skill:</b> {session.skill?.name}</p><p><b>Category:</b> {session.category?.name}</p><p><b>Local time:</b> {sessionWhen(session)} ({session.timezone})</p><p><b>Status:</b> {session.status}</p>{session.cancellationReason && <p><b>Cancellation reason:</b> {session.cancellationReason}</p>}</section>
      <section className="phase-panel phase-completion-panel"><div className="phase-completion-heading"><div><div className="eyebrow">SESSION WRAP-UP</div><h2>Completion & credits</h2></div><span className={`phase-session-status ${session.settlement?.status || "not_started"}`}>{session.settlement?.status || "not_started"}</span></div>
        <p>Charge: <b>{completion?.settlement?.pricePerLearner || session.creditPrice || 10} credits</b> · Tutor earning on settlement: <b>{session.settlement?.totalCredits || 0} credits</b></p>
        <div className="phase-completion-checks"><span><Check size={15}/> Tutor: {completion?.completion?.tutorRequestedAt ? "marked complete" : "awaiting confirmation request"}</span><span><Check size={15}/> Learner: {completion?.completion?.learnerConfirmedAt ? "confirmed" : "awaiting confirmation"}</span></div>
        {session.settlement?.failureReason && <div className="phase-alert error" role="alert"><CircleAlert size={16}/>{session.settlement.failureReason}</div>}
        {session.completion?.dispute?.reason && <div className="phase-alert error" role="status">Dispute recorded: {session.completion.dispute.reason}</div>}
        {session.status === "disputed" && <div className="phase-alert error" role="status">This session is disputed. <Link to="/disputes">Track the case</Link></div>}
        {notice && <div className="phase-alert success" role="status">{notice}</div>}
        <div className="phase-session-actions">
          {completion?.actions?.tutorCanRequest && <button className="button button-primary" disabled={busy} onClick={() => completeAction("request-completion")}>{busy ? "Saving..." : "Mark session complete"}</button>}
          {completion?.actions?.learnerCanConfirm && <button className="button button-primary" disabled={busy} onClick={() => completeAction("confirm-completion")}>{busy ? "Confirming..." : "Confirm completion"}</button>}
          {completion?.actions?.canSettle && session.settlement?.status === "failed" && <button className="button button-primary" disabled={busy} onClick={() => completeAction("settle")}>Retry settlement</button>}
        </div>
        {completion?.actions?.learnerCanDispute && <form className="phase-dispute-form" onSubmit={event => { event.preventDefault(); completeAction("dispute", { reason: disputeReason }); }}><label htmlFor="completion-dispute">If the session did not happen as agreed, explain why</label><textarea id="completion-dispute" minLength="3" maxLength="1000" required value={disputeReason} onChange={event => setDisputeReason(event.target.value)}/><button type="submit" className="button button-light" disabled={busy}>Raise a dispute</button></form>}
        {["scheduled", "completed"].includes(session.status) && <div className="phase-dispute-form"><button type="button" className="button button-light" onClick={() => setGeneralDisputeOpen(open => !open)}>Open a session dispute</button>{generalDisputeOpen && <form className="phase-form" onSubmit={submitDispute}><label>Reason<input required minLength="3" maxLength="160" value={generalDispute.reason} onChange={event => setGeneralDispute(current => ({ ...current, reason: event.target.value }))}/></label><label>Describe what happened<textarea required minLength="10" maxLength="3000" value={generalDispute.description} onChange={event => setGeneralDispute(current => ({ ...current, description: event.target.value }))}/></label><p className="muted">Opening a dispute will not transfer, reverse, or delete credits.</p><button className="button button-primary" disabled={busy}>{busy ? "Opening..." : "Submit dispute"}</button></form>}</div>}
      </section>
    </div>}
  </>;
}

function WalletPage({ onBalance }) {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async page => {
    setError("");
    try {
      const [walletResponse, transactionResponse] = await Promise.all([
        api.get("/wallet"),
        api.get("/wallet/transactions", { params: { page, limit: 10 } })
      ]);
      setSummary(walletResponse.data.data);
      onBalance?.(walletResponse.data.data.balance);
      setTransactions(transactionResponse.data.data.transactions);
      setPagination(transactionResponse.data.data.pagination);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(pagination.page); }, [pagination.page]);
  useEffect(() => {
    const socket = io(socketUrl, { withCredentials: true, transports: ["websocket"] });
    const refresh = notification => {
      if (notification?.type?.startsWith("session_settlement")) load(pagination.page);
    };
    socket.on("notification:new", refresh);
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [pagination.page]);
  const showTransaction = async id => {
    try {
      const response = await api.get(`/wallet/transactions/${id}`);
      setSelected(response.data.data.transaction);
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const label = item => ({
    "signup-grant": "Initial signup credits",
    "session-charge": "Credits spent learning",
    "session-earning": "Credits earned teaching",
    refund: "Refund",
    "admin-adjustment": "Auditable adjustment"
  }[item.type] || item.type);
  if (loading) return <Loading label="Loading wallet..."/>;
  return <><PageHeading eyebrow="YOUR CREDITS" title="Wallet" description="A clear, server-recorded history of learning charges and teaching earnings." action={<button className="button button-light" onClick={() => { setLoading(true); load(pagination.page); }}><RotateCw size={15}/>Refresh</button>}/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {summary && <div className="phase-wallet-stats"><article><span>Available balance</span><b>{summary.balance}</b><small>credits</small></article><article><span>Earned teaching</span><b>{summary.earned}</b><small>credits</small></article><article><span>Spent learning</span><b>{summary.spent}</b><small>credits</small></article><article><span>Signup grant</span><b>{summary.signupCredits}</b><small>credits (one-time)</small></article><article><span>Auditable adjustments</span><b>{summary.adjustmentCredits - summary.adjustmentDebits}</b><small>net credits</small></article></div>}
    {!!summary?.pendingSettlements?.length && <section className="phase-panel phase-wallet-pending"><h2>Settlement status</h2>{summary.pendingSettlements.map(item => <Link key={item._id} to={`/sessions/${item._id}`}><span><b>{item.title}</b><small>{item.settlement?.failureReason || `Status: ${item.settlement?.status}`}</small></span><span className={`phase-session-status ${item.settlement?.status}`}>{item.settlement?.status}</span></Link>)}</section>}
    <section className="phase-panel phase-wallet-history"><div className="phase-wallet-title"><h2>Transaction history</h2><span>{pagination.total} records</span></div>
      {transactions.map(item => <button type="button" className="phase-wallet-transaction" key={item._id} onClick={() => showTransaction(item._id)}><span className={`phase-wallet-direction ${item.direction}`}>{item.direction === "credit" ? <ArrowDownLeft size={16}/> : <ArrowUpRight size={16}/>}</span><span className="phase-wallet-copy"><b>{label(item)}</b><small>{item.description} · {new Date(item.createdAt).toLocaleString()}</small></span><strong className={item.direction}>{item.direction === "credit" ? "+" : "−"}{item.amount}</strong></button>)}
      {!transactions.length && !error && <div className="phase-empty"><Wallet size={26}/><h3>No transactions yet</h3><p>Your initial signup credits and future session payments will appear here.</p></div>}
      {pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={pagination.page <= 1} onClick={() => setPagination(current => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="button button-light" disabled={pagination.page >= pagination.pages} onClick={() => setPagination(current => ({ ...current, page: current.page + 1 }))}>Next</button></div>}
    </section>
    {selected && <div className="phase-modal-backdrop" onClick={() => setSelected(null)}><section className="phase-panel phase-transaction-modal" role="dialog" aria-modal="true" aria-label="Transaction details" onClick={event => event.stopPropagation()}><div className="phase-booking-head"><h2>Transaction details</h2><button className="phase-icon-btn" onClick={() => setSelected(null)} aria-label="Close details"><X size={16}/></button></div><p><b>{label(selected)}</b> · {selected.direction === "credit" ? "+" : "−"}{selected.amount} credits</p><p>{selected.description}</p><p>Balance: {selected.balanceBefore ?? "—"} → {selected.balanceAfter ?? "—"}</p><p>Counterparty: {selected.counterparty?.name || "—"}</p><p>{new Date(selected.createdAt).toLocaleString()}</p>{selected.session && <Link className="button button-light" to={`/sessions/${selected.session._id}`} onClick={() => setSelected(null)}>View {selected.session.title}</Link>}<small>Transaction ID: {selected.transactionId}</small></section></div>}
  </>;
}

function MyReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/reviews/me", { params: { limit: 50 } })
      .then(response => setReviews(response.data.data.reviews))
      .catch(requestError => setError(getMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);
  return <><PageHeading eyebrow="YOUR HISTORY" title="My reviews" description="Reviews you have submitted after confirmed learning sessions."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {loading ? <Loading label="Loading reviews..."/> : <section className="phase-panel phase-review-list">{reviews.map(review => <article key={review._id}><div><b>{review.recipient?.name} · {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</b><p>{review.text || "No written feedback"}</p><small>{review.session?.title} · {review.session?.startsAt ? new Date(review.session.startsAt).toLocaleDateString() : ""}</small></div></article>)}{!reviews.length && <div className="phase-empty"><Star size={24}/><h3>No reviews yet</h3><p>You can review a tutor after you confirm a completed session.</p><Link className="button button-light" to="/sessions">View my sessions</Link></div>}</section>}
  </>;
}

function MyDisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/disputes/me").then(response => setDisputes(response.data.data.disputes))
      .catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, []);
  return <><PageHeading eyebrow="SESSION SUPPORT" title="My disputes" description="Track dispute review and administrator decisions."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {loading ? <Loading label="Loading disputes..."/> : <section className="phase-panel phase-review-list">{disputes.map(dispute => <article key={dispute._id}><div><b>{dispute.session?.title} · {dispute.status.replace("_", " ")}</b><p>{dispute.reason}</p><small>Opened {new Date(dispute.createdAt).toLocaleString()}</small>{dispute.resolutionSummary && <p><b>Decision:</b> {dispute.resolutionSummary}</p>}</div><Link className="button button-light" to={`/sessions/${dispute.session?._id}`}>View session</Link></article>)}{!disputes.length && <div className="phase-empty"><h3>No disputes</h3><p>Any dispute you open about a session will appear here.</p></div>}</section>}
  </>;
}

function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/admin/dashboard").then(response => setData(response.data.data))
      .catch(requestError => setError(getMessage(requestError)));
  }, []);
  if (!data && !error) return <Loading label="Loading administration dashboard..."/>;
  return <><PageHeading eyebrow="ADMINISTRATION" title="Platform overview" description="Live account, session, review, ledger, and access data from MongoDB."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {data && <>
      <section className="phase8-stat-grid">
        <article><span>Registered users</span><b>{data.users.total}</b><small>{data.users.verified} verified · {data.users.unverified} unverified</small></article>
        <article><span>Active tutors</span><b>{data.users.activeTutors}</b><small>Verified, active accounts</small></article>
        <article><span>Active learners</span><b>{data.users.activeLearners}</b><small>Verified, active accounts</small></article>
        <article><span>Platform rating</span><b>{data.reviews.average.toFixed(2)} / 5</b><small>{data.reviews.count} reviews</small></article>
        <article><span>Credits issued</span><b>{data.credits.issued}</b><small>Ledger credit entries</small></article>
        <article><span>Credits transferred</span><b>{data.credits.transferred}</b><small>Settled learning charges</small></article>
      </section>
      <div className="phase8-admin-grid"><section className="phase-panel"><h2>Sessions by status</h2><div className="phase8-status-grid">{Object.entries(data.sessions).map(([status, count]) => <article key={status}><span>{status}</span><b>{count}</b></article>)}{!Object.keys(data.sessions).length && <p className="phase-empty-small">No sessions yet.</p>}</div></section>
        <section className="phase-panel"><h2>Usage policy</h2><p>{data.usage.dailyLimit} uses · {data.usage.cooldownHours} hour cooldown</p><small>Actions: {data.usage.activeActions.join(", ") || "none"}</small><h3>Plans</h3>{data.plans.map(plan => <p key={plan._id}>{plan.name} · {plan.isFree ? "Free" : `${plan.currency} ${plan.price}`} · {plan.isActive ? "Active" : "Inactive"}</p>)}</section></div>
      <nav className="phase8-admin-shortcuts"><Link className="button button-primary" to="/admin/users">Manage accounts</Link><Link className="button button-light" to="/admin/disputes">Review disputes</Link><Link className="button button-light" to="/admin/audit">Inspect audit logs</Link></nav>
    </>}
  </>;
}

function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await api.get("/admin/users", { params: { q: search || undefined, status: status || undefined, page, limit: 20 } });
      setUsers(response.data.data.users); setPagination(response.data.data.pagination);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [search, status, page]);
  const updateStatus = async event => {
    event.preventDefault(); if (!target) return;
    try {
      await api.patch(`/admin/users/${target._id}/status`, {
        accountStatus: target.accountStatus === "suspended" ? "active" : "suspended", reason
      });
      setTarget(null); setReason(""); await load();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const showSessions = async user => {
    try {
      const response = await api.get(`/admin/users/${user._id}/sessions`, { params: { limit: 20 } });
      setHistory({ user, sessions: response.data.data.sessions });
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  return <><PageHeading eyebrow="ADMINISTRATION" title="User management" description="Search accounts, review verification and activity, and suspend or reactivate with a recorded reason."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    <section className="phase-panel phase8-filter-row"><label>Search<input value={search} maxLength="100" onChange={event => { setPage(1); setSearch(event.target.value); }} placeholder="Name or email"/></label><label>Status<select value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option>{["active", "pending", "suspended", "deleted"].map(value => <option key={value}>{value}</option>)}</select></label><span>{pagination.total} accounts</span></section>
    {loading ? <Loading label="Loading accounts..."/> : <section className="phase-panel phase8-list">{users.map(user => <article key={user._id}><div><b>{user.name}</b><small>{user.email} · {user.accountStatus} · {user.isEmailVerified ? "Verified" : "Unverified"} · joined {new Date(user.createdAt).toLocaleDateString()}</small><small>{user.skillsToTeach?.length || 0} teaching skills · {user.skillsToLearn?.length || 0} learning interests</small></div><div className="phase8-actions"><button className="button button-light" onClick={() => showSessions(user)}>Session history</button>{user.accountType !== "admin" && user.accountStatus !== "pending" && user.accountStatus !== "deleted" && <button className={user.accountStatus === "suspended" ? "button button-primary" : "button button-light"} onClick={() => { setTarget(user); setReason(""); }}>{user.accountStatus === "suspended" ? "Reactivate" : "Suspend"}</button>}</div></article>)}{!users.length && <div className="phase-empty"><h3>No matching accounts</h3><p>Adjust the search or status filter.</p></div>}</section>}
    {!loading && pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page} of {pagination.pages}</span><button className="button button-light" disabled={page >= pagination.pages} onClick={() => setPage(current => current + 1)}>Next</button></div>}
    {target && <div className="phase-modal-backdrop"><form className="phase-panel phase-review-modal" onSubmit={updateStatus}><h2>{target.accountStatus === "suspended" ? "Reactivate account" : "Suspend account"}</h2><p>{target.name} · {target.email}</p><label>Reason<textarea required minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)}/></label><div className="phase-session-actions"><button type="button" className="button button-light" onClick={() => setTarget(null)}>Cancel</button><button className="button button-primary">Confirm</button></div></form></div>}
    {history && <div className="phase-modal-backdrop"><section className="phase-panel phase-review-modal"><div className="phase-availability-head"><h2>{history.user.name} · sessions</h2><button className="text-button" onClick={() => setHistory(null)}>Close</button></div>{history.sessions.map(session => <p key={session._id}>{session.title} · {session.status} · {new Date(session.startsAt).toLocaleString()}</p>)}{!history.sessions.length && <p>No sessions recorded.</p>}</section></div>}
  </>;
}

function AdminDisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [adjustment, setAdjustment] = useState({ userId: "", direction: "credit", amount: "", description: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => api.get("/admin/disputes", { params: { status: status || undefined, limit: 50 } })
    .then(response => setDisputes(response.data.data.disputes))
    .catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  useEffect(() => { setLoading(true); load(); }, [status]);
  const openDetail = async dispute => {
    setSelected(dispute); setError("");
    try { const response = await api.get(`/admin/disputes/${dispute._id}`); setDetail(response.data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const markReview = async () => {
    if (!selected) return;
    try { await api.patch(`/admin/disputes/${selected._id}/review`, { note }); await load(); await openDetail(selected); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const decide = async event => {
    event.preventDefault(); if (!selected) return;
    try {
      await api.patch(`/admin/disputes/${selected._id}/resolve`, {
        status: "RESOLVED", summary, internalNote: note,
        adjustment: adjustment.userId ? { ...adjustment, amount: Number(adjustment.amount) } : null
      }, { headers: adjustment.userId ? { "Idempotency-Key": idempotencyKey("dispute-adjustment") } : {} });
      setSelected(null); setDetail(null); setSummary(""); setNote(""); setAdjustment({ userId: "", direction: "credit", amount: "", description: "" }); await load();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const reject = async () => {
    if (!selected || summary.trim().length < 5) return setError("Enter a resolution summary before rejecting.");
    try {
      await api.patch(`/admin/disputes/${selected._id}/resolve`, { status: "REJECTED", summary, internalNote: note });
      setSelected(null); setDetail(null); await load();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  return <><PageHeading eyebrow="ADMINISTRATION" title="Dispute management" description="Review session context and decide disputes. Credit adjustments are optional, compensating ledger entries—not edits to original transfers."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    <section className="phase-panel phase8-filter-row"><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All</option>{["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"].map(value => <option key={value}>{value}</option>)}</select></label></section>
    {loading ? <Loading label="Loading disputes..."/> : <section className="phase-panel phase8-list">{disputes.map(dispute => <article key={dispute._id}><div><b>{dispute.reason} · {dispute.status}</b><small>{dispute.session?.title} · {dispute.learner?.name} ↔ {dispute.tutor?.name}</small><small>{new Date(dispute.createdAt).toLocaleString()}</small></div><button className="button button-light" onClick={() => openDetail(dispute)}>Review case</button></article>)}{!disputes.length && <div className="phase-empty"><h3>No disputes in this view</h3><p>Participant disputes appear here for review.</p></div>}</section>}
    {selected && <div className="phase-modal-backdrop"><section className="phase-panel phase8-dispute-modal"><div className="phase-availability-head"><div><div className="eyebrow">DISPUTE CASE</div><h2>{selected.reason}</h2></div><button className="text-button" onClick={() => { setSelected(null); setDetail(null); }}>Close</button></div>{!detail ? <Loading label="Loading case evidence..."/> : <>
      <p>{selected.learner?.name} ↔ {selected.tutor?.name} · {selected.session?.title} · {selected.status}</p><p>{selected.description}</p>
      <h3>Session ledger (read-only)</h3>{detail.ledger.map(entry => <small className="phase8-evidence" key={entry._id}>{entry.user?.name}: {entry.direction} {entry.amount} · {entry.type} · {entry.reference}</small>)}{!detail.ledger.length && <p>No credit transaction recorded. Opening a dispute did not transfer credits.</p>}
      <h3>Related conversation messages</h3><div className="phase8-messages">{detail.messages.map(message => <article key={message._id}><b>{message.sender?.name}</b><p>{message.text}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article>)}{!detail.messages.length && <p>No retained messages in this conversation.</p>}</div>
      <label>Internal note<textarea maxLength="2000" value={note} onChange={event => setNote(event.target.value)}/></label>
      {["OPEN", "UNDER_REVIEW"].includes(selected.status) && <><div className="phase-session-actions"><button className="button button-light" onClick={markReview}>Move to review</button></div><form className="phase-form phase8-decision-form" onSubmit={decide}><label>Resolution summary<textarea required minLength="5" maxLength="2000" value={summary} onChange={event => setSummary(event.target.value)}/></label><h3>Optional credit adjustment</h3><label>Participant<select value={adjustment.userId} onChange={event => setAdjustment(current => ({ ...current, userId: event.target.value }))}><option value="">No credit adjustment</option><option value={selected.learner?._id}>{selected.learner?.name} (learner)</option><option value={selected.tutor?._id}>{selected.tutor?.name} (tutor)</option></select></label>{adjustment.userId && <><label>Direction<select value={adjustment.direction} onChange={event => setAdjustment(current => ({ ...current, direction: event.target.value }))}><option value="credit">Credit</option><option value="debit">Debit (requires sufficient balance)</option></select></label><label>Amount<input type="number" min="1" max="100000" required value={adjustment.amount} onChange={event => setAdjustment(current => ({ ...current, amount: event.target.value }))}/></label><label>Ledger description<input required minLength="3" maxLength="300" value={adjustment.description} onChange={event => setAdjustment(current => ({ ...current, description: event.target.value }))}/></label><p className="muted">This writes a new, immutable compensating ledger entry. Existing entries remain unchanged.</p></>}<div className="phase-session-actions"><button className="button button-primary">Resolve dispute</button><button type="button" className="button button-light" onClick={reject}>Reject dispute</button></div></form></>}
    </>}</section></div>}
  </>;
}

function AdminAuditPage() {
  const [logs, setLogs] = useState([]);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get("/admin/audit-logs", { params: { action: action || undefined, outcome: outcome || undefined, page, limit: 50 } })
      .then(response => { setLogs(response.data.data.logs); setPagination(response.data.data.pagination); })
      .catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  }, [action, outcome, page]);
  return <><PageHeading eyebrow="ADMINISTRATION" title="Audit logs" description="Immutable records of administrative actions and authorization denials."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    <section className="phase-panel phase8-filter-row"><label>Action<input maxLength="120" value={action} onChange={event => { setPage(1); setAction(event.target.value); }} placeholder="Exact action name"/></label><label>Outcome<select value={outcome} onChange={event => { setPage(1); setOutcome(event.target.value); }}><option value="">All</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option></select></label><span>{pagination.total} records</span></section>
    {loading ? <Loading label="Loading audit logs..."/> : <section className="phase-panel phase8-list">{logs.map(log => <article key={log._id}><div><b>{log.action} · {log.outcome}</b><small>Actor: {log.actor?.name || "System/unknown"} · {log.actor?.email || ""}</small><small>{log.resourceType}{log.resourceId ? ` · ${log.resourceId}` : ""} · {new Date(log.createdAt).toLocaleString()}</small><small>{log.metadata?.method} {log.metadata?.path} · HTTP {log.metadata?.statusCode}{log.metadata?.changedFields?.length ? ` · fields: ${log.metadata.changedFields.join(", ")}` : ""}</small></div></article>)}{!logs.length && <div className="phase-empty"><h3>No matching audit entries</h3><p>Admin operations and authorization denials are retained here.</p></div>}</section>}
    {!loading && pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page} of {pagination.pages}</span><button className="button button-light" disabled={page >= pagination.pages} onClick={() => setPage(current => current + 1)}>Next</button></div>}
  </>;
}

function AdminSettlementAuditPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [reconciliation, setReconciliation] = useState(null);
  const [error, setError] = useState("");
  const load = async page => {
    try {
      const response = await api.get("/admin/settlements", { params: { page, limit: 20 } });
      setItems(response.data.data.items);
      setPagination(response.data.data.pagination);
      setError("");
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  useEffect(() => { load(pagination.page); }, [pagination.page]);
  const reconcile = async id => {
    try {
      const response = await api.get(`/admin/settlements/${id}/reconciliation`);
      setReconciliation(response.data.data.reconciliation);
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  return <><PageHeading eyebrow="READ-ONLY AUDIT" title="Settlement audit" description="Inspect committed ledger entries and reconcile session debits against tutor credits."/>
    {error && <div className="phase-alert error">{error}</div>}
    {reconciliation && <div className={`phase-alert ${reconciliation.balanced ? "success" : "error"}`} role="status">Reconciliation {reconciliation.balanced === null ? "not available (session is not settled)" : reconciliation.balanced ? "balanced" : "mismatch"} · debits {reconciliation.debitTotal} · tutor credits {reconciliation.tutorCreditTotal}</div>}
    <section className="phase-panel phase-audit-list">{items.map(item => <article key={item.sessionId}><div><b>Session {item.sessionId}</b><small>{item.tutor?.name} ← {item.learner?.name} · {item.status} · expected {item.expectedCharge} credits</small><small>{item.failureReason || `Collected and credited: ${item.totalCredits} credits`}</small></div><div>{item.entries.map(entry => <small key={entry._id}>{entry.direction} {entry.amount} · {entry.reference}</small>)}<button type="button" className="button button-light" onClick={() => reconcile(item.sessionId)}>Reconcile</button></div></article>)}{!items.length && <div className="phase-empty"><h3>No settlement records</h3><p>Completed or failed settlements will be listed for review.</p></div>}</section>
    {pagination.pages > 1 && <div className="phase-pagination"><button className="button button-light" disabled={pagination.page <= 1} onClick={() => setPagination(current => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="button button-light" disabled={pagination.page >= pagination.pages} onClick={() => setPagination(current => ({ ...current, page: current.page + 1 }))}>Next</button></div>}
  </>;
}

function ChatPage({ user }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const selfId = String(user.id || user._id);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationSessions, setConversationSessions] = useState([]);
  const [pagination, setPagination] = useState({ hasMore: false, nextBefore: null, nextBeforeId: null });
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [typingName, setTypingName] = useState("");
  const [online, setOnline] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [liveNotice, setLiveNotice] = useState("");
  const socketRef = useRef(null);
  const activeIdRef = useRef(conversationId);
  const otherIdRef = useRef("");
  const messagePaneRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const pendingScrollHeightRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const typingTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const requestRef = useRef(0);
  activeIdRef.current = conversationId;
  otherIdRef.current = String(conversation?.participants?.find(participant => String(participant._id) !== selfId)?._id || "");

  const refreshConversations = async () => {
    const response = await api.get("/conversations");
    setConversations(response.data.data.conversations);
  };

  useEffect(() => {
    setLoading(true);
    api.get("/conversations").then(response => setConversations(response.data.data.conversations))
      .catch(requestError => setError(getMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = io(socketUrl, { autoConnect: false, withCredentials: true, reconnection: true });
    socketRef.current = socket;
    setConnected(false);
    const updateListForMessage = message => {
      const id = String(message.conversation);
      setConversations(items => {
        const current = items.find(item => String(item._id) === id);
        if (!current) {
          refreshConversations().catch(requestError => setError(getMessage(requestError)));
          return items;
        }
        const isOpen = activeIdRef.current === id;
        return items.map(item => String(item._id) !== id ? item : {
          ...item,
          lastMessage: message,
          lastMessagePreview: message.deletedAt ? "Message deleted" : message.text,
          lastActivityAt: message.createdAt,
          unreadCount: isOpen || String(message.sender?._id || message.sender) === selfId
            ? item.unreadCount : (item.unreadCount || 0) + 1
        }).sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      });
    };
    const onConnect = () => {
      setConnected(true);
      setError("");
      const activeId = activeIdRef.current;
      if (activeId) socket.emit("conversation:join", { conversationId: activeId }, response => {
        setOnline(Boolean(response?.success && response.data.onlineUsers?.includes(otherIdRef.current)));
      });
    };
    const onDisconnect = () => { setConnected(false); setOnline(false); setTypingName(""); };
    const onNewMessage = ({ message }) => {
      if (!message) return;
      updateListForMessage(message);
      if (String(message.conversation) === activeIdRef.current) {
        setMessages(current => current.some(item => String(item._id) === String(message._id)) ? current : [...current, message]);
        if (String(message.sender?._id || message.sender) !== selfId) {
          api.patch(`/conversations/${message.conversation}/read`).catch(requestError => setError(getMessage(requestError)));
          socket.emit("message:read", { conversationId: message.conversation });
        }
      }
    };
    const onMessageEdit = ({ message }) => {
      setMessages(current => current.map(item => String(item._id) === String(message._id) ? message : item));
      updateListForMessage(message);
    };
    const onMessageDelete = ({ message }) => {
      setMessages(current => current.map(item => String(item._id) === String(message._id) ? message : item));
      updateListForMessage(message);
    };
    const onRead = ({ userId: readerId }) => {
      if (String(readerId) === selfId) return;
      setMessages(current => current.map(message => String(message.sender?._id || message.sender) === selfId
        ? { ...message, readBy: [...new Set([...(message.readBy || []).map(String), String(readerId)])] }
        : message));
    };
    const onTypingStart = ({ userId: typingId, name }) => {
      if (String(typingId) === selfId) return;
      setTypingName(name || "Someone");
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setTypingName(""), 2500);
    };
    const onTypingStop = ({ userId: typingId }) => {
      if (String(typingId) !== selfId) setTypingName("");
    };
    const onUserOnline = ({ userId: onlineId }) => {
      if (String(onlineId) === otherIdRef.current) setOnline(true);
    };
    const onUserOffline = ({ userId: offlineId }) => {
      if (String(offlineId) === otherIdRef.current) setOnline(false);
    };
    const onConnectionUpdate = data => setConversation(current => current ? {
      ...current,
      connectionRequest: { ...current.connectionRequest, status: data.status }
    } : current);
    const onSessionUpdate = ({ session }) => {
      if (!session || String(session.conversation?._id || session.conversation) !== activeIdRef.current) return;
      setConversationSessions(items => {
        const exists = items.some(item => String(item._id) === String(session._id));
        return exists ? items.map(item => String(item._id) === String(session._id) ? session : item) : [session, ...items];
      });
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:new", onNewMessage);
    socket.on("message:edit", onMessageEdit);
    socket.on("message:delete", onMessageDelete);
    socket.on("message:read", onRead);
    socket.on("typing:start", onTypingStart);
    socket.on("typing:stop", onTypingStop);
    socket.on("user:online", onUserOnline);
    socket.on("user:offline", onUserOffline);
    socket.on("connection:update", onConnectionUpdate);
    for (const event of ["session:proposed", "session:accepted", "session:rejected", "session:cancelled", "session:reschedule-proposed", "session:reschedule-accepted", "session:reschedule-rejected", "session:completion-requested", "session:completion-confirmed", "session:disputed", "session:settled", "session:settlement-failed"]) {
      socket.on(event, onSessionUpdate);
    }
    socket.on("connection:new", () => refreshConversations().catch(requestError => setError(getMessage(requestError))));
    socket.on("notification:new", notification => {
      setLiveNotice(notification?.message || "You have a new notification.");
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setLiveNotice(""), 4500);
      refreshConversations().catch(requestError => setError(getMessage(requestError)));
    });
    socket.on("connect_error", () => setError("Chat connection unavailable. Reconnecting..."));
    socket.connect();
    return () => {
      clearTimeout(typingTimerRef.current);
      clearTimeout(noticeTimerRef.current);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [selfId]);

  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setConversationSessions([]);
      setLoading(false);
      return undefined;
    }
    const requestNumber = ++requestRef.current;
    setLoading(true);
    setError("");
    setConversation(null);
    setMessages([]);
    if (socketRef.current?.connected) socketRef.current.emit("conversation:join", { conversationId }, response => {
      setOnline(Boolean(response?.success && response.data.onlineUsers?.includes(otherIdRef.current)));
    });
    Promise.all([
      api.get(`/conversations/${encodeURIComponent(conversationId)}`),
      api.get(`/conversations/${encodeURIComponent(conversationId)}/messages`, { params: { limit: 40 } }),
      api.get("/sessions", { params: { conversation: conversationId, limit: 50 } })
    ]).then(async ([conversationResponse, messageResponse, sessionResponse]) => {
      if (requestNumber !== requestRef.current) return;
      setConversation(conversationResponse.data.data.conversation);
      setMessages(messageResponse.data.data.messages);
      setConversationSessions(sessionResponse.data.data.sessions);
      setPagination(messageResponse.data.data.pagination);
      shouldAutoScrollRef.current = true;
      await api.patch(`/conversations/${encodeURIComponent(conversationId)}/read`);
      socketRef.current?.emit("message:read", { conversationId });
      setConversations(items => items.map(item => String(item._id) === String(conversationId) ? { ...item, unreadCount: 0 } : item));
    }).catch(requestError => {
      if (requestNumber === requestRef.current) setError(getMessage(requestError));
    }).finally(() => {
      if (requestNumber === requestRef.current) setLoading(false);
    });
    return () => {
      if (socketRef.current?.connected) socketRef.current.emit("conversation:leave", { conversationId });
    };
  }, [conversationId]);

  useLayoutEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane) return;
    if (pendingScrollHeightRef.current !== null) {
      pane.scrollTop = pane.scrollHeight - pendingScrollHeightRef.current;
      pendingScrollHeightRef.current = null;
    } else if (shouldAutoScrollRef.current) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [messages]);

  const loadOlder = async () => {
    if (!conversationId || !pagination.hasMore || loadingOlderRef.current || !messages.length) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const pane = messagePaneRef.current;
    pendingScrollHeightRef.current = pane?.scrollHeight ?? 0;
    try {
      const oldest = messages[0];
      const response = await api.get(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
        params: { limit: 40, before: oldest.createdAt, beforeId: oldest._id }
      });
      const data = response.data.data;
      setMessages(current => [...data.messages, ...current.filter(message =>
        !data.messages.some(old => String(old._id) === String(message._id)))]);
      setPagination(data.pagination);
    } catch (requestError) {
      pendingScrollHeightRef.current = null;
      setError(getMessage(requestError));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const send = async event => {
    event.preventDefault();
    const messageText = text.trim();
    if (!messageText || !conversationId || sending) return;
    setSending(true);
    setError("");
    const clientMessageId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      let message;
      if (socketRef.current?.connected) {
        const result = await new Promise((resolve, reject) => {
          socketRef.current.emit("message:send", { conversationId, text: messageText, clientMessageId }, response => {
            if (response?.success) resolve(response.data);
            else reject(new Error(response?.message || "Message could not be sent"));
          });
        });
        message = result.message;
      } else {
        const response = await api.post(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
          text: messageText,
          clientMessageId
        });
        message = response.data.data.message;
      }
      setMessages(current => current.some(item => String(item._id) === String(message._id)) ? current : [...current, message]);
      setText("");
      shouldAutoScrollRef.current = true;
      setConversations(items => items.map(item => String(item._id) === String(conversationId) ? {
        ...item,
        lastMessage: message,
        lastMessagePreview: message.text,
        lastActivityAt: message.createdAt
      } : item).sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt)));
      if (socketRef.current?.connected) socketRef.current.emit("typing:stop", { conversationId });
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setSending(false);
    }
  };

  const setTyping = value => {
    setText(value);
    const socket = socketRef.current;
    if (!socket?.connected || !conversationId) return;
    socket.emit("typing:start", { conversationId });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => socket.emit("typing:stop", { conversationId }), 1200);
  };

  const respondToConnection = async action => {
    const id = conversation?.connectionRequest?._id;
    if (!id || connectionBusy) return;
    setConnectionBusy(true);
    setError("");
    try {
      const response = await api.patch(`/connections/${id}/${action}`);
      setConversation(current => ({ ...current, connectionRequest: response.data.data.connection }));
      await refreshConversations();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setConnectionBusy(false); }
  };

  const updateMessage = async () => {
    try {
      const response = await api.patch(`/messages/${editingId}`, { text: editText });
      const message = response.data.data.message;
      setMessages(current => current.map(item => String(item._id) === String(message._id) ? message : item));
      setEditingId("");
    } catch (requestError) { setError(getMessage(requestError)); }
  };

  const removeMessage = async messageId => {
    if (!globalThis.confirm("Delete this message?")) return;
    try {
      const response = await api.delete(`/messages/${messageId}`);
      const message = response.data.data.message;
      setMessages(current => current.map(item => String(item._id) === String(message._id) ? message : item));
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const sessionAction = async (id, action) => {
    try {
      if (action === "reschedule-form") {
        setRescheduleTarget(conversationSessions.find(item => String(item._id) === String(id)));
        return;
      }
      if (action === "cancel") {
        const reason = globalThis.prompt("Why are you cancelling this session?");
        if (!reason) return;
        const response = await api.patch(`/sessions/${id}/cancel`, { reason });
        setConversationSessions(items => items.map(item => item._id === id ? response.data.data.session : item));
      } else {
        const response = await api.patch(`/sessions/${id}/${action}`);
        setConversationSessions(items => items.map(item => item._id === id ? response.data.data.session : item));
      }
    } catch (requestError) { setError(getMessage(requestError)); }
  };

  const activeConnection = conversation?.connectionRequest;
  const isTutor = String(activeConnection?.tutor?._id || activeConnection?.tutor) === selfId;
  const otherParticipant = conversation?.participants?.find(participant => String(participant._id) !== selfId);
  return <div className={`phase-chat-layout ${conversationId ? "chat-active" : ""}`}>
    {liveNotice && <div className="phase-live-notice" role="status" aria-live="polite">
      <span>{liveNotice}</span><button type="button" onClick={() => setLiveNotice("")}>Dismiss</button>
    </div>}
    <aside className="phase-panel phase-chat-list">
      <div className="phase-chat-list-head"><div><div className="eyebrow">YOUR LEARNING PARTNERS</div><h1>Messages</h1></div><span>{conversations.length}</span></div>
      {loading && !conversations.length ? <Loading label="Loading conversations..."/> : conversations.map(item => {
        const other = item.participants.find(participant => String(participant._id) !== selfId);
        return <Link className={`phase-chat-list-item ${String(item._id) === String(conversationId) ? "active" : ""}`} to={`/chat/${item._id}`} key={item._id}>
          <span className="phase-avatar">{other?.profileImage ? <img src={other.profileImage} alt=""/> : other?.name?.[0]?.toUpperCase()}</span>
          <span className="phase-chat-list-copy"><b>{other?.name || "Skill Swap member"}</b><small>{item.skill?.name || "Learning conversation"}</small><span>{item.lastMessage?.deletedAt ? "Message deleted" : item.lastMessagePreview || "Start your conversation"}</span></span>
          <span className="phase-chat-list-side">{item.unreadCount > 0 && <i>{item.unreadCount}</i>}<small>{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : ""}</small></span>
        </Link>;
      })}
      {!loading && !conversations.length && <div className="phase-empty-small">No conversations yet. Connect with a tutor to start chatting.</div>}
      <Link to="/tutors" className="button button-light phase-browse-tutors">Find a tutor</Link>
    </aside>
    <section className="phase-panel phase-chat-panel">
      {!conversationId ? <div className="phase-chat-empty"><MessageCircle size={36}/><h2>Your conversations</h2><p>Select a conversation or connect with a tutor to start learning together.</p></div> :
        loading ? <Loading label="Loading conversation..."/> : error && !conversation ? <div className="phase-alert error">{error}</div> : conversation && <>
          <header className="phase-chat-header"><button className="phase-chat-back" onClick={() => navigate("/chat")} aria-label="Back to conversations"><ArrowLeft size={18}/></button><span className="phase-avatar">{otherParticipant?.profileImage ? <img src={otherParticipant.profileImage} alt=""/> : otherParticipant?.name?.[0]?.toUpperCase()}</span><div><b>{otherParticipant?.name || "Skill Swap member"}</b><small>{online ? "Online now" : connected ? "Chat connected" : "Reconnecting..."} · {conversation.skill?.name}</small></div>{isTutor && activeConnection?.status === "pending" && <div className="phase-connection-actions"><button className="button button-primary" disabled={connectionBusy} onClick={() => respondToConnection("accept")}>Accept</button><button className="button button-light" disabled={connectionBusy} onClick={() => respondToConnection("reject")}>Decline</button></div>}<button className="button button-light phase-schedule-button" disabled={!isTutor || activeConnection?.status !== "accepted"} title={!isTutor ? "Only the tutor can propose a session" : activeConnection?.status !== "accepted" ? "Accept the connection before proposing a session" : "Schedule a session"} onClick={() => setBookingOpen(true)}><CalendarDays size={15}/>Schedule session</button></header>
          {activeConnection?.status === "rejected" && <div className="phase-chat-notice">This connection request was declined.</div>}
          {scheduleOpen && <div className="phase-schedule-placeholder" role="status"><CalendarDays size={17}/> Use Schedule session to send a booking proposal.</div>}
          {conversationSessions.length > 0 && <section className="phase-chat-session-cards" aria-label="Session proposals and bookings"><h3>Sessions in this conversation</h3>{conversationSessions.map(session => <SessionCard key={session._id} session={session} userId={selfId} onAction={sessionAction}/>)}</section>}
          <div className="phase-chat-messages" ref={messagePaneRef} onScroll={event => {
            const pane = event.currentTarget;
            shouldAutoScrollRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 90;
            if (pane.scrollTop < 45) loadOlder();
          }} aria-live="polite">
            {loadingOlder && <div className="phase-chat-loading-older">Loading older messages...</div>}
            {!pagination.hasMore && <div className="phase-chat-start"><span>Conversation about {conversation.skill?.name}</span></div>}
            {messages.map(message => {
              const own = String(message.sender?._id || message.sender) === selfId;
              const read = own && (message.readBy || []).some(id => String(id?._id || id) !== selfId);
              return <article className={`phase-message ${own ? "own" : ""}`} key={message._id}>
                {!own && <span className="phase-message-sender">{message.sender?.name || otherParticipant?.name}</span>}
                {editingId === String(message._id) ? <div className="phase-message-edit"><textarea value={editText} maxLength="4000" onChange={event => setEditText(event.target.value)}/><button onClick={updateMessage}>Save</button><button onClick={() => setEditingId("")}>Cancel</button></div> :
                  <div className="phase-message-bubble">{message.deletedAt ? <i>This message was deleted</i> : message.text}</div>}
                <div className="phase-message-meta"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{message.editedAt && <span>edited</span>}{read && <span>Read</span>}{own && !message.deletedAt && !editingId && <span className="phase-message-tools"><button onClick={() => { setEditingId(String(message._id)); setEditText(message.text); }}>Edit</button><button onClick={() => removeMessage(String(message._id))}>Delete</button></span>}</div>
              </article>;
            })}
            {typingName && <div className="phase-typing-indicator">{typingName} is typing…</div>}
          </div>
          {error && <div className="phase-chat-error" role="alert">{error}</div>}
          <form className="phase-chat-composer" onSubmit={send}><textarea aria-label="Message" rows="1" maxLength="4000" value={text} onChange={event => setTyping(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder={`Message ${otherParticipant?.name || "your learning partner"}...`}/><button className="button button-primary" disabled={!text.trim() || sending}><Send size={16}/>{sending ? "Sending..." : "Send"}</button></form>
        </>}
    </section>
    {bookingOpen && conversation && <SessionBookingForm
      conversationId={conversationId}
      skill={conversation.skill}
      tutorName={user.name}
      learnerName={otherParticipant?.name || "Learner"}
      onClose={() => setBookingOpen(false)}
      onCreated={session => setConversationSessions(items => [session, ...items.filter(item => item._id !== session._id)])}
    />}
    {rescheduleTarget && <RescheduleForm session={rescheduleTarget} onClose={() => setRescheduleTarget(null)} onSaved={session => {
      setConversationSessions(items => items.map(item => item._id === session._id ? session : item));
      setLiveNotice("New-time proposal sent for confirmation.");
    }}/>}
  </div>;
}

function AdminCatalogPage() {
  const [categories, setCategories] = useState([]);
  const [catalogCategory, setCatalogCategory] = useState("");
  const [catalogSkills, setCatalogSkills] = useState([]);
  const [skillForm, setSkillForm] = useState({ name: "", description: "" });
  const [editingCategory, setEditingCategory] = useState("");
  const [categoryEditName, setCategoryEditName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "", parent: "" });
  const [suggestions, setSuggestions] = useState([]);
  const load = () => Promise.all([api.get("/admin/categories", { params: { limit: 100 } }), api.get("/skills/suggestions")]).then(([categoryResponse, suggestionResponse]) => {
    setCategories(categoryResponse.data.data.categories);
    setSuggestions(suggestionResponse.data.data.suggestions);
  }).catch(requestError => setError(getMessage(requestError)));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const category = categories.find(item => item._id === catalogCategory);
    if (!category) { setCatalogSkills([]); return; }
    api.get(`/categories/${encodeURIComponent(category.slug)}/skills`)
      .then(response => setCatalogSkills(response.data.data.skills.filter(skill => String(skill.category?._id) === category._id)))
      .catch(requestError => setError(getMessage(requestError)));
  }, [catalogCategory, categories]);
  const create = async event => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      await api.post("/categories", { ...form, parent: form.parent || null });
      setForm({ name: "", description: "", parent: "" }); setMessage("Category created."); load();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const toggleCategory = async category => {
    try { await api.patch(`/categories/${category._id}`, { isActive: !category.isActive }); setMessage(`Category ${category.isActive ? "deactivated" : "activated"}.`); load(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const review = async (id, status) => {
    try { await api.patch(`/skills/suggestions/${id}`, { status }); setMessage(`Suggestion ${status}.`); load(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const saveCategoryName = async id => {
    try { await api.patch(`/categories/${id}`, { name: categoryEditName }); setEditingCategory(""); setCategoryEditName(""); setMessage("Category updated."); load(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const createSkill = async event => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      await api.post("/skills", { ...skillForm, category: catalogCategory });
      setSkillForm({ name: "", description: "" }); setMessage("Skill created."); load();
    } catch (requestError) { setError(getMessage(requestError)); }
  };
  const updateSkill = async (skill, changes) => {
    try { await api.patch(`/skills/${skill._id}`, changes); setMessage("Skill updated."); load(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const deactivateSkill = async skill => {
    try { await api.delete(`/skills/${skill._id}`); setMessage("Skill deactivated."); load(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  return <><PageHeading eyebrow="ADMIN TOOLS" title="Category and skill catalog" description="Changes here are stored in MongoDB and appear in search and user profiles."/><div className="phase-profile-grid"><form className="phase-panel phase-form" onSubmit={create}><h2>Create category</h2><label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Description<textarea rows="3" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></label><label>Parent category<select value={form.parent} onChange={event => setForm({ ...form, parent: event.target.value })}><option value="">Top-level category</option>{categories.filter(category => category.isActive).map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label><button className="button button-primary">Create category</button>{categories.map(category => <div className="phase-admin-row" key={category._id}>{editingCategory === category._id ? <><input aria-label={`Rename ${category.name}`} value={categoryEditName} onChange={event => setCategoryEditName(event.target.value)}/><button type="button" className="text-button" onClick={() => saveCategoryName(category._id)}>Save</button><button type="button" className="text-button" onClick={() => setEditingCategory("")}>Cancel</button></> : <><span><b>{category.name}</b><small>{category.slug} · {category.isActive ? "Active" : "Inactive"}</small></span><button type="button" className="text-button" onClick={() => { setEditingCategory(category._id); setCategoryEditName(category.name); }}>Edit</button><button type="button" className="text-button" onClick={() => toggleCategory(category)}>{category.isActive ? "Deactivate" : "Activate"}</button></>}</div>)}</form><section className="phase-panel"><h2>Manage skills</h2><form className="phase-form" onSubmit={createSkill}><label>Category<select required value={catalogCategory} onChange={event => setCatalogCategory(event.target.value)}><option value="">Choose category</option>{categories.map(category => <option key={category._id} value={category._id} disabled={!category.isActive}>{category.name}{category.isActive ? "" : " (inactive)"}</option>)}</select></label><label>Skill name<input required minLength="2" maxLength="100" value={skillForm.name} onChange={event => setSkillForm({ ...skillForm, name: event.target.value })}/></label><label>Description<textarea maxLength="1500" value={skillForm.description} onChange={event => setSkillForm({ ...skillForm, description: event.target.value })}/></label><button className="button button-primary" disabled={!catalogCategory || !categories.find(category => category._id === catalogCategory)?.isActive}>Add skill</button></form>{catalogSkills.map(skill => <AdminSkillRow key={skill._id} skill={skill} onSave={changes => updateSkill(skill, changes)} onDeactivate={() => deactivateSkill(skill)}/>)}</section><section className="phase-panel"><h2>Skill suggestions awaiting review</h2>{suggestions.map(item => <div className="phase-suggestion" key={item._id}><b>{item.name}</b><small>{item.category?.name} · suggested by {item.suggestedBy?.name}</small><p>{item.description}</p><div><button className="button button-primary" onClick={() => review(item._id, "approved")}><Check size={15}/>Approve</button><button className="button button-light" onClick={() => review(item._id, "rejected")}>Reject</button></div></div>)}{!suggestions.length && <p className="muted">There are no pending suggestions.</p>}</section></div>{error && <div className="phase-alert error">{error}</div>}{message && <div className="phase-alert success">{message}</div>}</>;
}

function AdminSkillRow({ skill, onSave, onDeactivate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description || "");
  if (!editing) return <div className="phase-admin-row"><span><b>{skill.name}</b><small>{skill.slug}</small></span><button className="text-button" onClick={() => setEditing(true)}>Edit</button><button className="text-button" onClick={onDeactivate}>Deactivate</button></div>;
  return <div className="phase-admin-skill-edit"><input aria-label={`Skill name ${skill.name}`} value={name} onChange={event => setName(event.target.value)}/><textarea aria-label={`Skill description ${skill.name}`} value={description} onChange={event => setDescription(event.target.value)}/><div><button className="text-button" onClick={() => { onSave({ name, description }); setEditing(false); }}>Save</button><button className="text-button" onClick={() => setEditing(false)}>Cancel</button></div></div>;
}

const DEFAULT_LIMIT_MESSAGE = "You have reached your usage limit for today. You can use Skill Swap again after 12 hours or upgrade your plan for additional access.";

function useRemainingTime(expiry) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiry) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiry]);
  if (!expiry) return "";
  const seconds = Math.max(0, Math.floor((new Date(expiry).getTime() - now) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function UsageStatusCard({ item, cooldownHours, onRefresh }) {
  const remaining = useRemainingTime(item.cooldownUntil);
  const actualCooldownHours = item.cooldownHours ?? cooldownHours;
  const message = actualCooldownHours === 12 ? DEFAULT_LIMIT_MESSAGE
    : `This action is restricted for ${actualCooldownHours} hours after reaching its limit. The timer below shows the remaining time.`;
  return <article className={`phase-panel phase-usage-card ${item.restricted ? "restricted" : ""}`}>
    <div className="phase-usage-title"><span><Gauge size={18}/>{item.action.replaceAll("_", " ")}</span><b>{item.consumed} / {item.allowance} used</b></div>
    <div className="phase-progress"><span style={{ width: `${Math.min(100, (item.consumed / Math.max(1, item.allowance)) * 100)}%` }}/></div>
    <p>{item.remaining} remaining today</p>
    {item.restricted && <div className="phase-usage-cooldown"><b>{message}</b><span>Access returns in <time>{remaining || "00:00:00"}</time></span><small>Cooldown started {new Date(item.cooldownStartedAt).toLocaleString()} · expires {new Date(item.cooldownUntil).toLocaleString()}</small>{remaining === "00:00:00" && <button className="button button-light" onClick={onRefresh}>Refresh access</button>}<Link className="button button-primary" to="/plans">Upgrade plan</Link></div>}
  </article>;
}

function UsagePage() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    Promise.all([api.get("/usage/status"), api.get("/usage/history")])
      .then(([statusResponse, historyResponse]) => {
        setStatus(statusResponse.data.data.status);
        setHistory(historyResponse.data.data.records);
      }).catch(requestError => setError(getMessage(requestError))).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  if (loading) return <Loading label="Loading your usage..."/>;
  return <><PageHeading eyebrow="ACCESS & USAGE" title="Usage status" description="Limits are enforced by the server and reset at midnight UTC." action={<Link className="button button-primary" to="/plans">Compare plans</Link>}/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}
    {status && <><section className="phase-usage-summary"><div className="phase-panel"><span>Current plan</span><b>{status.plan?.name || "Free"}</b><Link to="/plans">Compare access</Link></div><div className="phase-panel"><span>Daily reset</span><b>{new Date(status.policy.resetsAt).toLocaleString()}</b></div><div className="phase-panel"><span>Cooldown policy</span><b>{status.policy.cooldownHours} hours</b></div></section>
      <div className="phase-usage-grid">{status.usage.map(item => <UsageStatusCard key={item.action} item={item} cooldownHours={status.policy.cooldownHours} onRefresh={load}/>)}</div></>}
    <section className="phase-panel phase-usage-history"><h2><History size={18}/> Recent usage</h2>{history.map(item => <article className="phase-usage-history-row" key={item._id}><b>{item.action.replaceAll("_", " ")}</b><span>{new Date(item.createdAt).toLocaleString()}</span></article>)}{!history.length && <p className="phase-empty-small">No usage history yet.</p>}</section>
  </>;
}

function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [checkoutAvailable, setCheckoutAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyPlan, setBusyPlan] = useState("");
  useEffect(() => {
    Promise.all([api.get("/plans"), api.get("/subscriptions/me").catch(() => null)])
      .then(([planResponse, subscriptionResponse]) => {
        setPlans(planResponse.data.data.plans);
        setCheckoutAvailable(planResponse.data.data.checkoutAvailable);
        if (subscriptionResponse) setSubscription(subscriptionResponse.data.data);
      }).catch(requestError => setError(getMessage(requestError)));
  }, []);
  const checkout = async plan => {
    setBusyPlan(plan.id); setError(""); setNotice("");
    try {
      const response = await api.post("/subscriptions/checkout", { planId: plan.id }, {
        headers: { "Idempotency-Key": idempotencyKey("checkout") }
      });
      const result = response.data.data;
      if (result.payment.redirectUrl) {
        window.location.assign(result.payment.redirectUrl);
        return;
      }
      setNotice(response.data.message);
      if (result.checkoutMode === "demo") setNotice(`${response.data.message} This record is for development testing only.`);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusyPlan(""); }
  };
  return <><PageHeading eyebrow="PLANS & ACCESS" title="Choose your learning pace" description="Plan details and allowances are loaded from your account's subscription catalog."/>
    {!checkoutAvailable && <div className="phase-alert phase-demo-note" role="status">Development/demo checkout only: no payment provider is configured. Demo checkout does not activate paid entitlements.</div>}
    {error && <div className="phase-alert error" role="alert">{error}</div>}{notice && <div className="phase-alert success" role="status">{notice}</div>}
    {subscription?.activePlan && <section className="phase-panel phase-current-plan"><div><div className="eyebrow">CURRENT ACCESS</div><h2>{subscription.activePlan.name}</h2><p>{subscription.current ? `Active until ${new Date(subscription.current.endsAt).toLocaleString()}` : "No active paid subscription."}</p></div><Link className="button button-light" to="/billing">Billing settings</Link></section>}
    <div className="phase-plan-grid">{plans.map(plan => <article className={`phase-panel phase-plan-card ${plan.isFree ? "free" : ""}`} key={plan.id}><span className="phase-plan-label">{plan.isFree ? "COMMUNITY" : "SUBSCRIPTION"}</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="phase-plan-price">{plan.price === 0 ? "Free" : `${plan.currency} ${plan.price}`}<small>{plan.billingPeriod !== "none" ? ` / ${plan.billingPeriod}` : ""}</small></div><p className="phase-plan-allowance">{plan.usageLimit} configured restricted actions per day · {plan.cooldownHours}h cooldown</p><ul>{(plan.benefits || []).map((benefit, index) => <li key={`${benefit}-${index}`}><Check size={15}/>{benefit}</li>)}</ul>{plan.accessRestrictions?.length > 0 && <p className="phase-plan-restrictions">{plan.accessRestrictions.join(" ")}</p>}
      {!plan.isFree && <button className="button button-primary" disabled={Boolean(busyPlan)} onClick={() => checkout(plan)}>{busyPlan === plan.id ? "Starting checkout..." : checkoutAvailable ? "Continue to secure checkout" : "Demo checkout (no payment)"}</button>}
    </article>)}</div>
    {!plans.length && <div className="phase-empty">No active plans are available right now.</div>}
    <section className="phase-panel phase-plan-footnote"><b>Essential access is protected.</b><p>Usage limits do not block login, account recovery, security and safety actions, support, existing conversations, or session cancellation.</p></section>
  </>;
}

function BillingPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/subscriptions/me").then(response => setData(response.data.data)).catch(requestError => setError(getMessage(requestError)));
  useEffect(() => { load(); }, []);
  const cancel = async () => {
    if (!data?.current || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post("/subscriptions/cancel", { subscriptionId: data.current._id }, { headers: { "Idempotency-Key": idempotencyKey("cancel") } });
      setNotice("Subscription cancelled; historical billing records remain available.");
      await load();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="ACCOUNT BILLING" title="Billing settings" description="View your current access and payment history." action={<Link className="button button-light" to="/plans">Compare plans</Link>}/>
    {error && <div className="phase-alert error">{error}</div>}{notice && <div className="phase-alert success">{notice}</div>}
    {!data ? <Loading label="Loading billing details..."/> : <>
      <section className="phase-panel phase-billing-current"><div><div className="eyebrow">CURRENT PLAN</div><h2>{data.activePlan?.name || "Free"}</h2><p>{data.current ? `${data.current.status} · renews/expires ${new Date(data.current.endsAt).toLocaleString()}` : "No paid subscription is active."}</p></div>{data.current?.status === "active" && <button className="button button-light" disabled={busy} onClick={cancel}>{busy ? "Cancelling..." : "Cancel subscription"}</button>}</section>
      <section className="phase-panel phase-usage-history"><h2><CreditCard size={18}/> Payment history</h2>{data.payments.map(payment => <article className="phase-usage-history-row" key={payment.id}><b>{payment.status === "demo_unpaid" ? "Demo checkout · no payment" : payment.status}</b><span>{payment.currency} {payment.amount} · {new Date(payment.createdAt).toLocaleString()}</span></article>)}{!data.payments.length && <p className="phase-empty-small">No checkout history yet.</p>}</section>
      <section className="phase-panel phase-usage-history"><h2>Subscription history</h2>{data.subscriptions.map(item => <article className="phase-usage-history-row" key={item._id}><b>{item.plan?.name || "Plan"} · {item.status}</b><span>{new Date(item.startsAt).toLocaleDateString()} – {new Date(item.endsAt).toLocaleDateString()}</span></article>)}{!data.subscriptions.length && <p className="phase-empty-small">No subscription history yet.</p>}</section>
    </>}
  </>;
}

function AdminPlanRow({ plan, onSave, onToggle }) {
  const [values, setValues] = useState({
    name: plan.name,
    description: plan.description || "",
    price: String(plan.price),
    currency: plan.currency,
    usageLimit: String(plan.usageLimit),
    cooldownHours: String(plan.cooldownHours),
    billingPeriod: plan.billingPeriod
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(plan, {
        ...values,
        price: Number(values.price),
        usageLimit: Number(values.usageLimit),
        cooldownHours: Number(values.cooldownHours)
      });
      setEditing(false);
    } finally { setBusy(false); }
  };
  if (editing) return <form className="phase-admin-plan-edit" onSubmit={save}>
    <label>Name<input required minLength="2" maxLength="100" value={values.name} onChange={event => setValues({ ...values, name: event.target.value })}/></label>
    <label>Description<input maxLength="1000" value={values.description} onChange={event => setValues({ ...values, description: event.target.value })}/></label>
    <div className="phase-form-row"><label>Price<input type="number" min={plan.isFree ? "0" : "0.01"} step="0.01" value={values.price} onChange={event => setValues({ ...values, price: event.target.value })}/></label><label>Currency<input maxLength="3" value={values.currency} onChange={event => setValues({ ...values, currency: event.target.value.toUpperCase() })}/></label></div>
    <div className="phase-form-row"><label>Daily allowance<input type="number" min="1" max="10000" value={values.usageLimit} onChange={event => setValues({ ...values, usageLimit: event.target.value })}/></label><label>Cooldown hours<input type="number" min="1" max="720" step="0.5" value={values.cooldownHours} onChange={event => setValues({ ...values, cooldownHours: event.target.value })}/></label></div>
    <label>Billing period<select value={values.billingPeriod} onChange={event => setValues({ ...values, billingPeriod: event.target.value })}><option value="none">None</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
    <div><button className="button button-primary" disabled={busy}>{busy ? "Saving..." : "Save plan"}</button><button type="button" className="button button-light" onClick={() => setEditing(false)}>Cancel</button></div>
  </form>;
  return <article className="phase-admin-row"><span><b>{plan.name} · {plan.currency} {plan.price} · {plan.usageLimit}/day</b><small>{plan.billingPeriod} · {plan.isActive ? "active" : "inactive"}</small></span><button className="text-button" onClick={() => setEditing(true)}>Edit</button><button className="text-button" onClick={() => onToggle(plan)}>{plan.isActive ? "Deactivate" : "Activate"}</button></article>;
}

function AdminUsagePage() {
  const [policy, setPolicy] = useState(null);
  const [plans, setPlans] = useState([]);
  const [statistics, setStatistics] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [form, setForm] = useState({ name: "", description: "", price: "0", currency: "USD", usageLimit: "20", cooldownHours: "12", billingPeriod: "monthly" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    const [policyResponse, planResponse, statsResponse, restrictionResponse] = await Promise.all([
      api.get("/admin/usage/policy"), api.get("/admin/usage/plans"),
      api.get("/admin/usage/statistics"), api.get("/admin/usage/restrictions", { params: { limit: 20 } })
    ]);
    setPolicy(policyResponse.data.data.policy);
    setPlans(planResponse.data.data.plans);
    setStatistics(statsResponse.data.data.statistics);
    setRestrictions(restrictionResponse.data.data.records);
  };
  useEffect(() => { reload().catch(requestError => setError(getMessage(requestError))); }, []);
  const savePolicy = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.put("/admin/usage/policy", {
        activeActions: policy.activeActionsText.split(",").map(action => action.trim()).filter(Boolean),
        dailyLimit: Number(policy.dailyLimit),
        cooldownHours: Number(policy.cooldownHours)
      });
      setPolicy({ ...response.data.data.policy, activeActionsText: response.data.data.policy.activeActions.join(", ") });
      setNotice("Usage policy saved.");
      await reload();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const createPlan = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api.post("/admin/usage/plans", {
        ...form,
        price: Number(form.price), usageLimit: Number(form.usageLimit), cooldownHours: Number(form.cooldownHours),
        isFree: false, isActive: true, description: form.description,
        benefits: form.description ? [form.description] : [],
        includedFeatures: [], restrictedFeatures: [], accessRestrictions: [], displayOrder: plans.length + 1
      });
      setNotice("Plan created.");
      setForm({ name: "", description: "", price: "0", currency: "USD", usageLimit: "20", cooldownHours: "12", billingPeriod: "monthly" });
      await reload();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  };
  const togglePlan = async plan => {
    try { await api.patch(`/admin/usage/plans/${plan._id}`, { isActive: !plan.isActive }); await reload(); }
    catch (requestError) { setError(getMessage(requestError)); }
  };
  const savePlan = async (plan, values) => {
    try {
      await api.patch(`/admin/usage/plans/${plan._id}`, values);
      setNotice("Plan updated.");
      await reload();
    } catch (requestError) {
      setError(getMessage(requestError));
      throw requestError;
    }
  };
  return <><PageHeading eyebrow="ADMINISTRATION" title="Usage & plans" description="Configure discovery limits, subscription catalog visibility, and review aggregate restriction records."/>
    {error && <div className="phase-alert error" role="alert">{error}</div>}{notice && <div className="phase-alert success" role="status">{notice}</div>}
    {!policy ? <Loading label="Loading policy..."/> : <div className="phase-admin-usage-grid"><form className="phase-panel phase-form" onSubmit={savePolicy}><h2>Usage policy</h2><label>Restricted actions (comma separated)<input value={policy.activeActionsText ?? policy.activeActions.join(", ")} onChange={event => setPolicy({ ...policy, activeActionsText: event.target.value })}/></label><div className="phase-form-row"><label>Daily action allowance<input type="number" min="1" max="10000" required value={policy.dailyLimit} onChange={event => setPolicy({ ...policy, dailyLimit: Number(event.target.value) })}/></label><label>Cooldown hours<input type="number" min="1" max="720" step="0.5" required value={policy.cooldownHours} onChange={event => setPolicy({ ...policy, cooldownHours: Number(event.target.value) })}/></label></div><p className="muted">Current actions: {policy.activeActions.join(", ")}. Changes take effect for new reservations.</p><button className="button button-primary" disabled={busy}>Save policy</button></form>
      <section className="phase-panel"><h2>Create paid plan</h2><form className="phase-form" onSubmit={createPlan}><label>Plan name<input required minLength="2" maxLength="100" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Description<input maxLength="1000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></label><div className="phase-form-row"><label>Price<input required type="number" min="0.01" step="0.01" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })}/></label><label>Currency<input required maxLength="3" value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value.toUpperCase() })}/></label></div><div className="phase-form-row"><label>Daily allowance<input required type="number" min="1" max="10000" value={form.usageLimit} onChange={event => setForm({ ...form, usageLimit: event.target.value })}/></label><label>Cooldown hours<input required type="number" min="1" max="720" step="0.5" value={form.cooldownHours} onChange={event => setForm({ ...form, cooldownHours: event.target.value })}/></label></div><label>Billing period<select value={form.billingPeriod} onChange={event => setForm({ ...form, billingPeriod: event.target.value })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><button className="button button-primary" disabled={busy}>Create plan</button></form></section>
    </div>}
    <section className="phase-panel phase-admin-plan-list"><h2>Subscription plans</h2>{plans.map(plan => <AdminPlanRow plan={plan} key={plan._id} onSave={savePlan} onToggle={togglePlan}/>)}</section>
    <div className="phase-admin-usage-grid"><section className="phase-panel"><h2>Usage statistics</h2>{statistics.map(item => <article className="phase-usage-history-row" key={item.action}><b>{item.action}</b><span>{item.uses} events · {item.uniqueUsers} users</span></article>)}{!statistics.length && <p className="phase-empty-small">No usage recorded.</p>}</section><section className="phase-panel"><h2>Recent restrictions</h2>{restrictions.map(item => <article className="phase-usage-history-row" key={item._id}><b>{item.user?.name || "User"} · {item.action}</b><span>{item.count} / {item.plan?.name || "plan"} · {item.cooldownUntil ? new Date(item.cooldownUntil).toLocaleString() : "cooldown expired"}</span></article>)}{!restrictions.length && <p className="phase-empty-small">No restrictions recorded.</p>}</section></div>
  </>;
}

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    api.get("/auth/me").then(response => setUser(response.data.data.user)).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);
  const logout = async () => {
    try { await api.post("/auth/logout"); }
    finally { setUser(null); window.location.assign("/"); }
  };
  if (authLoading) return <Loading label="Checking your account..."/>;
  const protectedPage = element => <Protected user={user}>{element}</Protected>;
  const adminPage = element => <Protected user={user}>{user?.accountType === "admin" ? element : <Navigate to="/dashboard" replace/>}</Protected>;
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage onLogin={setUser}/>}/>
    <Route path="/register" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage onLogin={setUser}/>}/>
    <Route path="/reset-password" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage onLogin={setUser}/>}/>
    <Route path="/categories" element={<AppShell user={user || { name: "Guest", creditBalance: 0 }} onLogout={logout}><CategoriesPage/></AppShell>}/>
    <Route path="/categories/:slug" element={<AppShell user={user || { name: "Guest", creditBalance: 0 }} onLogout={logout}><CategoryPage/></AppShell>}/>
    <Route path="/dashboard" element={protectedPage(<AppShell user={user} onLogout={logout}><Dashboard user={user}/></AppShell>)}/>
    <Route path="/profile" element={protectedPage(<AppShell user={user} onLogout={logout}><ProfilePage onUserUpdated={setUser}/></AppShell>)}/>
    <Route path="/my-skills" element={protectedPage(<AppShell user={user} onLogout={logout}><MySkillsPage/></AppShell>)}/>
    <Route path="/tutors" element={protectedPage(<AppShell user={user} onLogout={logout}><TutorSearchPage/></AppShell>)}/>
    <Route path="/tutors/:id" element={protectedPage(<AppShell user={user} onLogout={logout}><TutorProfilePage/></AppShell>)}/>
    <Route path="/chat" element={protectedPage(<AppShell user={user} onLogout={logout}><ChatPage user={user}/></AppShell>)}/>
    <Route path="/chat/:conversationId" element={protectedPage(<AppShell user={user} onLogout={logout}><ChatPage user={user}/></AppShell>)}/>
    <Route path="/sessions" element={protectedPage(<AppShell user={user} onLogout={logout}><MySessionsPage user={user}/></AppShell>)}/>
    <Route path="/sessions/:id" element={protectedPage(<AppShell user={user} onLogout={logout}><SessionDetailsPage user={user} onBalance={balance => setUser(current => current ? { ...current, creditBalance: balance } : current)}/></AppShell>)}/>
    <Route path="/reviews" element={protectedPage(<AppShell user={user} onLogout={logout}><MyReviewsPage/></AppShell>)}/>
    <Route path="/disputes" element={protectedPage(<AppShell user={user} onLogout={logout}><MyDisputesPage/></AppShell>)}/>
    <Route path="/wallet" element={protectedPage(<AppShell user={user} onLogout={logout}><WalletPage onBalance={balance => setUser(current => current ? { ...current, creditBalance: balance } : current)}/></AppShell>)}/>
    <Route path="/usage" element={protectedPage(<AppShell user={user} onLogout={logout}><UsagePage/></AppShell>)}/>
    <Route path="/plans" element={<AppShell user={user || { name: "Guest", creditBalance: 0 }} onLogout={logout}><PlansPage/></AppShell>}/>
    <Route path="/billing" element={protectedPage(<AppShell user={user} onLogout={logout}><BillingPage/></AppShell>)}/>
    <Route path="/notifications" element={protectedPage(<AppShell user={user} onLogout={logout}><NotificationsPage/></AppShell>)}/>
    <Route path="/admin" element={adminPage(<AppShell user={user} onLogout={logout}><AdminDashboardPage/></AppShell>)}/>
    <Route path="/admin/users" element={adminPage(<AppShell user={user} onLogout={logout}><AdminUsersPage/></AppShell>)}/>
    <Route path="/admin/disputes" element={adminPage(<AppShell user={user} onLogout={logout}><AdminDisputesPage/></AppShell>)}/>
    <Route path="/admin/audit" element={adminPage(<AppShell user={user} onLogout={logout}><AdminAuditPage/></AppShell>)}/>
    <Route path="/admin/catalog" element={adminPage(<AppShell user={user} onLogout={logout}><AdminCatalogPage/></AppShell>)}/>
    <Route path="/admin/settlements" element={adminPage(<AppShell user={user} onLogout={logout}><AdminSettlementAuditPage/></AppShell>)}/>
    <Route path="/admin/usage" element={adminPage(<AppShell user={user} onLogout={logout}><AdminUsagePage/></AppShell>)}/>
    <Route path="/" element={<LandingPage/>}/>
    <Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace/>}/>
  </Routes>;
}

export default App;
