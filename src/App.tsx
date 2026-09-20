import { FormEvent, MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Ban,
  Bolt,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  LayoutDashboard,
  LogOut,
  Plus,
  Radio,
  Settings,
  Target,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { runDevelopmentHealthCheck } from './lib/healthCheck'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Status = 'todo' | 'in_progress' | 'done' | 'blocked'
type View = 'kanban' | 'focus'
type User = { id: string; name: string; role: 'lead' | 'member'; avatar_initials: string }
type Task = { id: string; title: string; description: string; assignee_id: string | null; created_by: string; status: Status; created_at: string; assignee?: User }

const statusLabel: Record<Status, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', blocked: 'Blocked' }

function logSupabaseError(context: string, error: unknown) {
  console.error(`[HackSync] ${context}`, error)
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<View>('kanban')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [showAuth, setShowAuth] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountEmail, setAccountEmail] = useState('')
  const [profileError, setProfileError] = useState('')
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [error, setError] = useState('')
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    runDevelopmentHealthCheck()
    if (!supabase) { setLoading(false); return }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) loadProfile(data.user.id, data.user)
      else setLoading(false)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id, session.user)
      else setShowAuth(true)
    })
    return () => authListener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !user) return
    const client = supabase
    const channel = client.channel(`hacksync-tasks-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${user.id}` }, () => loadTasks(user.id)).subscribe((status) => setOnline(status === 'SUBSCRIBED'))
    return () => { client.removeChannel(channel) }
  }, [user])

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAccountMenuOpen(false); return }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
      event.preventDefault()
      const currentIndex = menuItemsRef.current.findIndex((item) => item === document.activeElement)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (currentIndex + direction + menuItemsRef.current.length) % menuItemsRef.current.length
      menuItemsRef.current[nextIndex]?.focus()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', handleMenuKeyDown)
    menuItemsRef.current[0]?.focus()
    return () => { document.removeEventListener('mousedown', closeOnOutsideClick); document.removeEventListener('keydown', handleMenuKeyDown) }
  }, [accountMenuOpen])

  async function loadProfile(id: string, authUser?: { email?: string | null; user_metadata?: Record<string, unknown> }) {
    if (!supabase) return
    setLoading(true)
    setDataError('')
    const fallbackName = String(authUser?.user_metadata?.name || authUser?.email?.split('@')[0] || 'Operator')
    const fallbackProfile: User = { id, name: fallbackName, role: 'member', avatar_initials: fallbackName.slice(0, 2).toUpperCase() }
    const { data: profile, error: profileError } = await supabase.from('users').select('*').eq('id', id).maybeSingle()

    if (profileError) {
      logSupabaseError('Profile load failed', profileError)
      setError('We could not load your account right now. Please try again.')
      setLoading(false)
      return
    }

    if (profile) {
      setUser(profile)
    } else {
      const { data: createdProfile, error: createProfileError } = await supabase.from('users').insert(fallbackProfile).select().single()
      if (createProfileError || !createdProfile) {
        logSupabaseError('Profile creation failed', createProfileError)
        setError('We could not set up your account right now. Please try again.')
        setLoading(false)
        return
      }
      setUser(createdProfile)
    }

    setError('')
    setAccountEmail(authUser?.email || '')
    setShowAuth(false)
    setMembers([profile || fallbackProfile])
    await loadTasks(id)
    setLoading(false)
  }

  async function loadTasks(userId: string) {
    if (!supabase) return
    const { data, error: tasksError } = await supabase.from('tasks').select('*, assignee:users!tasks_assignee_id_fkey(*)').or(`created_by.eq.${userId},assignee_id.eq.${userId}`).order('created_at', { ascending: false })
    if (tasksError) {
      logSupabaseError('Task load failed', tasksError)
      setDataError('We could not load your workspace right now. Please try again.')
      setTasks([])
      return
    }
    setDataError('')
    setTasks((data || []) as Task[])
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget); const email = String(form.get('email')); const password = String(form.get('password')); const name = String(form.get('name') || email.split('@')[0])
    if (!supabase) { setError('Supabase is not connected. Add the required environment variables and restart the app.'); return }
    const result = authMode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { data: { name } } })
    if (result.error) {
      logSupabaseError('Authentication failed', result.error)
      setError('We could not sign you in. Check your details and try again.')
    } else if (authMode === 'signup' && !result.data.session) {
      setError('Account created. Check your email, then return here to enter the room.')
    } else if (result.data.user) {
      await loadProfile(result.data.user.id, result.data.user)
    }
  }

  async function updateTask(id: string, status: Status) {
    if (!supabase || !user) return
    const { error: updateError } = await supabase.from('tasks').update({ status }).eq('id', id).eq('assignee_id', user.id)
    if (updateError) { logSupabaseError('Task update failed', updateError); setDataError('We could not update that task. Please try again.') }
    else await loadTasks(user.id)
  }

  async function createTask(title: string, description: string, assigneeId: string) {
    if (!supabase || !user) return
    const assignee = members.find((member) => member.id === assigneeId) ?? user
    const { error: createError } = await supabase.from('tasks').insert({ title, description, assignee_id: assignee.id, created_by: user.id })
    if (createError) {
      logSupabaseError('Task creation failed', createError)
      setDataError('We could not create that task. Please try again.')
      return
    }
    setShowCreate(false)
    await loadTasks(user.id)
  }

  function openProfileEditor() {
    setAccountMenuOpen(false)
    setProfileError('')
    setProfileOpen(true)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const avatarInitials = String(form.get('avatar_initials') || '').trim().toUpperCase()
    if (!name || !avatarInitials) { setProfileError('Enter a name and avatar initials.'); return }
    const { data, error: updateError } = await supabase.from('users').update({ name, avatar_initials: avatarInitials }).eq('id', user.id).select().single()
    if (updateError || !data) {
      logSupabaseError('Profile update failed', updateError)
      setProfileError('We could not update your profile. Please try again.')
      return
    }
    setUser(data)
    setMembers((current) => current.map((member) => member.id === data.id ? data : member))
    setProfileOpen(false)
  }

  async function signOut() {
    if (supabase) {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) logSupabaseError('Sign out failed', signOutError)
    }
    setAccountMenuOpen(false)
    setUser(null)
    setMembers([])
    setTasks([])
    setAccountEmail('')
    setShowAuth(true)
  }

  if (!isSupabaseConfigured) return <ConnectionState />
  if (showAuth || !user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} error={error} />
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Zap size={17} /></div><div><strong>HACKSYNC</strong><span>TEAM WAR ROOM</span></div></div>
      <nav className="view-switcher"><button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}><LayoutDashboard size={15} /> Board</button><button className={view === 'focus' ? 'active' : ''} onClick={() => setView('focus')}><Target size={15} /> Focus</button></nav>
      <div className="top-actions"><span className="live-status"><i className={online ? 'pulse' : ''} /> {online ? 'LIVE SYNC' : 'SYNCING'}</span><div className="account-menu-wrap" ref={accountMenuRef}><button className="avatar" title="Open account menu" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{user.avatar_initials}<span className="online-dot" /></button>{accountMenuOpen && <AccountMenu user={user} email={accountEmail} menuItemsRef={menuItemsRef} onEditProfile={openProfileEditor} onSettings={() => { setAccountMenuOpen(false); setSettingsOpen(true) }} onSignOut={signOut} />}</div></div>
    </header>
    <main className="workspace">
      <section className="sprint-banner"><div className="banner-icon"><Bolt size={18} /></div><div><div className="eyebrow">SPRINT VELOCITY <span>• {tasks.filter((task) => task.status !== 'done').length}/{tasks.length} TASKS ACTIVE</span></div><strong>Dev War Room // Workspace Ready</strong></div>{user.role === 'lead' && <button className="secondary-button" onClick={() => setShowCreate(true)}><Plus size={15} /> TASK</button>}</section>
      {dataError ? <DataError message={dataError} onRetry={() => loadTasks(user.id)} /> : view === 'kanban' ? <Kanban tasks={tasks} onUpdate={updateTask} onCreate={() => setShowCreate(true)} canCreate={user.role === 'lead'} /> : <Focus tasks={tasks} user={user} onUpdate={updateTask} onCreate={() => setShowCreate(true)} canCreate={user.role === 'lead'} />}
    </main>
    {showCreate && <CreateModal members={members} onClose={() => setShowCreate(false)} onCreate={createTask} />}
    {profileOpen && <ProfileModal user={user} error={profileError} onClose={() => setProfileOpen(false)} onSave={saveProfile} />}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
  </div>
}

function ConnectionState() {
  return <div className="auth-shell"><div className="auth-panel"><div className="brand auth-brand"><div className="brand-mark"><Zap size={17} /></div><div><strong>HACKSYNC</strong><span>TEAM WAR ROOM</span></div></div><div className="auth-copy"><span className="eyebrow">CONNECTION REQUIRED</span><h1>Supabase is<br /><em>not connected.</em></h1><p>Add your Supabase URL and publishable key to <code>.env</code>, then restart the app.</p></div><div className="connection-note"><Radio size={16} /> No local or demo data is available.</div></div><div className="auth-aside"><div className="signal-orbit"><div className="orbit-core"><Zap size={35} /></div><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div><p>LIVE DATA ONLY</p><span>Connect a project to enter the war room.</span></div></div>
}

function DataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="data-error"><span className="eyebrow">DATA LINK FAILURE</span><h2>{message}</h2><p>Check your connection and try again.</p><button className="secondary-button" onClick={onRetry}>RETRY CONNECTION</button></div>
}

function AccountMenu({ user, email, menuItemsRef, onEditProfile, onSettings, onSignOut }: { user: User; email: string; menuItemsRef: MutableRefObject<Array<HTMLButtonElement | null>>; onEditProfile: () => void; onSettings: () => void; onSignOut: () => void }) {
  return <div className="account-menu" role="menu" aria-label="Account menu">
    <div className="account-menu-header"><span className="avatar small">{user.avatar_initials}</span><div><strong>{user.name}</strong><span>{email || `${user.role} account`}</span></div><b>{user.role}</b></div>
    <div className="account-menu-divider" />
    <button ref={(element) => { menuItemsRef.current[0] = element }} className="account-menu-item" role="menuitem" onClick={onEditProfile}><UserRound size={15} /> Edit Profile</button>
    <button ref={(element) => { menuItemsRef.current[1] = element }} className="account-menu-item" role="menuitem" onClick={onSettings}><Settings size={15} /> Settings</button>
    <div className="account-menu-divider" />
    <button ref={(element) => { menuItemsRef.current[2] = element }} className="account-menu-item danger" role="menuitem" onClick={onSignOut}><LogOut size={15} /> Log Out</button>
  </div>
}

function ProfileModal({ user, error, onClose, onSave }: { user: User; error: string; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop"><form className="modal" onSubmit={onSave}><div className="modal-heading"><div><span className="eyebrow">ACCOUNT SETTINGS</span><h2>Edit profile</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close profile editor"><X size={18} /></button></div><label>DISPLAY NAME<input name="name" defaultValue={user.name} required /></label><label>AVATAR INITIALS<input name="avatar_initials" defaultValue={user.avatar_initials} maxLength={3} required /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button wide" onClick={onClose}>CANCEL</button><button className="primary-button wide" type="submit"><UserRound size={15} /> SAVE PROFILE</button></div></form></div>
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal settings-modal"><div className="modal-heading"><div><span className="eyebrow">WORKSPACE PREFERENCES</span><h2>Settings</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button></div><div className="settings-row"><div><strong>Theme</strong><span>Obsidian Telemetry</span></div><b>ACTIVE</b></div><div className="settings-row"><div><strong>Notifications</strong><span>Realtime task updates are enabled.</span></div><b className="settings-ok">LIVE</b></div><button className="secondary-button wide" onClick={onClose}>CLOSE SETTINGS</button></div></div>
}

function AuthScreen({ mode, setMode, onSubmit, error }: { mode: 'login' | 'signup'; setMode: (mode: 'login' | 'signup') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  const [showPassword, setShowPassword] = useState(false)
  return <div className="auth-shell"><div className="auth-panel"><div className="brand auth-brand"><div className="brand-mark"><Zap size={17} /></div><div><strong>HACKSYNC</strong><span>TEAM WAR ROOM</span></div></div><div className="auth-copy"><span className="eyebrow">{mode === 'login' ? 'AUTHENTICATE OPERATOR' : 'REGISTER OPERATOR'}</span><h1>Ship the demo.<br /><em>Stay in sync.</em></h1><p>Real-time task coordination, built for high-velocity teams</p></div><form className="auth-form" onSubmit={onSubmit}>{mode === 'signup' && <label>DISPLAY NAME<input name="name" required placeholder="Kyro" /></label>}<label>EMAIL ADDRESS<input name="email" type="email" required placeholder="you@team.dev" /></label><label>PASSWORD<div className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={6} placeholder="••••••••" /><button className="password-toggle" type="button" onPointerDown={() => setShowPassword(true)} onPointerUp={() => setShowPassword(false)} onPointerLeave={() => setShowPassword(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setShowPassword(true) }} onKeyUp={() => setShowPassword(false)} aria-label="Hold to show password" title="Hold to show password">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === 'login' ? 'ENTER WAR ROOM' : 'CREATE OPERATOR'} <ArrowRight size={16} /></button></form><button className="text-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Need access? Create an account' : 'Already have access? Sign in'}</button><div className="auth-foot"><Radio size={14} /> {isSupabaseConfigured ? 'Encrypted Supabase session' : 'Preview mode · add Supabase keys to activate auth'}</div></div><div className="auth-aside"><div className="signal-orbit"><div className="orbit-core"><Zap size={35} /></div><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div><p>EVERY SECOND COUNTS</p><span>Live state. One shared source of truth.</span></div></div>
}

function Kanban({ tasks, onUpdate, onCreate, canCreate }: { tasks: Task[]; onUpdate: (id: string, status: Status) => void; onCreate: () => void; canCreate: boolean }) {
  const columns: Status[] = ['todo', 'in_progress', 'done']
  return <div className="screen-content"><div className="screen-heading"><div><span className="eyebrow">MISSION CONTROL / BOARD</span><h1>Team Tasks</h1><p>Move fast. Keep the whole room calibrated.</p></div>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={16} /> NEW TASK</button>}</div><div className="mobile-tabs">{columns.map((status) => <span key={status}>{statusLabel[status].toUpperCase()} <b>{tasks.filter((task) => task.status === status).length}</b></span>)}</div>{tasks.length === 0 ? <div className="empty-state board-empty"><h2>No tasks yet</h2><p>Create your first task to start the workspace.</p>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={16} /> CREATE FIRST TASK</button>}</div> : <div className="kanban-grid">{columns.map((status) => <div className="kanban-column" key={status}><div className="column-heading"><div><i className={`status-dot ${status}`} /><span>{statusLabel[status].toUpperCase()}</span><b>{tasks.filter((task) => task.status === status).length}</b></div><small>{status === 'in_progress' ? 'LIVE' : status === 'done' ? 'VERIFIED' : 'QUEUE'}</small></div><div className="task-stack">{tasks.filter((task) => task.status === status).map((task) => <TaskCard key={task.id} task={task} onUpdate={onUpdate} />)}</div></div>)}</div>}</div>
}

function TaskCard({ task, onUpdate }: { task: Task; onUpdate: (id: string, status: Status) => void }) {
  const nextStatus: Status = task.status === 'todo' || task.status === 'blocked' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo'
  return <article className={`task-card ${task.status}`}><div className="task-meta"><span>{task.id}</span><StatusPill status={task.status} /></div><h3>{task.title}</h3><p>{task.description}</p><div className="task-footer"><div className="assignee"><span className="avatar small">{task.assignee?.avatar_initials ?? '??'}</span><span>{task.assignee?.name ?? 'Unassigned'}<small>{task.assignee?.role === 'lead' ? 'Team Lead' : 'Team Member'}</small></span></div>{task.status !== 'done' && <button className="card-action" onClick={() => onUpdate(task.id, nextStatus)}>{task.status === 'in_progress' ? 'DONE' : 'START'} <ArrowRight size={13} /></button>}{task.status === 'done' && <CheckCircle2 size={18} className="done-icon" />}</div></article>
}

function Focus({ tasks, user, onUpdate, onCreate, canCreate }: { tasks: Task[]; user: User; onUpdate: (id: string, status: Status) => void; onCreate: () => void; canCreate: boolean }) {
  const mine = useMemo(() => tasks.filter((task) => task.assignee_id === user.id), [tasks, user.id]); const complete = mine.filter((task) => task.status === 'done').length; const percent = mine.length ? Math.round((complete / mine.length) * 100) : 0
  return <div className="focus-sheet screen-content"><div className="focus-banner"><span><i className="status-dot in_progress" /> SPRINT ROOM • WEEK 2 DEMO</span><b>CALM MODE</b></div><div className="screen-heading"><div><span className="eyebrow">PERSONAL EXECUTION LOOP</span><h1>Today's Focus <em>// MVP</em></h1><p>{mine.length - complete} tasks remaining for demo <span className="impact-pill">HIGH IMPACT</span></p></div>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={16} /> ADD TASK</button>}</div><div className="progress-panel"><div><span>COMPLETION TRAJECTORY</span><strong>{percent}%</strong></div><div className="progress-track"><i style={{ width: `${percent}%` }} /></div><div><small>Safe, rapid implementation path</small><small>{complete} / {mine.length} COMPLETED</small></div></div><div className="focus-list">{mine.map((task) => <FocusTask key={task.id} task={task} onUpdate={onUpdate} />)}{!mine.length && <div className="empty-state">No tasks assigned to you yet. Ask the lead to route something your way.</div>}</div></div>
}

function FocusTask({ task, onUpdate }: { task: Task; onUpdate: (id: string, status: Status) => void }) { const done = task.status === 'done'; return <article className={`focus-task ${done ? 'is-done' : ''}`}><button className={`checkbox ${done ? 'checked' : ''}`} onClick={() => onUpdate(task.id, done ? 'todo' : 'done')} aria-label={done ? 'Reopen task' : 'Complete task'}>{done && <Check size={14} />}</button><div className="focus-task-copy"><strong>{task.title}</strong><span><i className="avatar tiny">{task.assignee?.avatar_initials}</i>{task.assignee?.name}</span></div><div className="focus-task-actions"><StatusPill status={task.status} />{!done && <button className={`flag-button ${task.status === 'blocked' ? 'flagged' : ''}`} onClick={() => onUpdate(task.id, task.status === 'blocked' ? 'todo' : 'blocked')}><Ban size={13} /> {task.status === 'blocked' ? 'UNBLOCK' : 'BLOCK'}</button>}</div></article> }

function StatusPill({ status }: { status: Status }) { return <span className={`status-pill ${status}`}><i className="status-dot" />{statusLabel[status]}</span> }
function CreateModal({ members, onClose, onCreate }: { members: User[]; onClose: () => void; onCreate: (title: string, description: string, assigneeId: string) => void }) { const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [assignee, setAssignee] = useState(members[0].id); return <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate(title.trim(), description.trim(), assignee) }}><div className="modal-heading"><div><span className="eyebrow">MISSION CONTROL</span><h2>Deploy a task</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>TASK TITLE<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Wire live judge demo" autoFocus /></label><label>DESCRIPTION<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does done look like?" rows={3} /></label><label>ASSIGN TO<div className="select-wrap"><select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select><ChevronDown size={15} /></div></label><div className="modal-actions"><button type="button" className="secondary-button wide" onClick={onClose}>CANCEL</button><button className="primary-button wide" type="submit"><Zap size={15} /> DEPLOY TASK</button></div></form></div> }

export default App
