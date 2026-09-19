import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Ban,
  Bolt,
  Check,
  CheckCircle2,
  ChevronDown,
  Chrome,
  LayoutDashboard,
  LogOut,
  Plus,
  Radio,
  Target,
  X,
  Zap,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Status = 'todo' | 'in_progress' | 'done' | 'blocked'
type View = 'kanban' | 'focus'
type User = { id: string; name: string; role: 'lead' | 'member'; avatar_initials: string }
type Task = { id: string; title: string; description: string; assignee_id: string | null; status: Status; created_at: string; assignee?: User }

const demoUsers: User[] = [
  { id: 'alex', name: 'Alex Liu', role: 'lead', avatar_initials: 'AL' },
  { id: 'mira', name: 'Mira K.', role: 'member', avatar_initials: 'MK' },
  { id: 'devin', name: 'Devin R.', role: 'member', avatar_initials: 'DR' },
  { id: 'sasha', name: 'Sasha O.', role: 'member', avatar_initials: 'SO' },
]

const demoTasks: Task[] = [
  { id: 'HK-108', title: 'Implement Vector RAG Fallback Router', description: 'Deploy a local model fallback when the Tier 1 provider hits rate limits during the live pitch.', assignee_id: 'alex', status: 'blocked', created_at: '2026-09-18', assignee: demoUsers[0] },
  { id: 'HK-109', title: 'Prepare 2-Min Live Pitch Deck', description: 'Frame the problem, latency benchmark graphs, and the interactive judge simulator.', assignee_id: 'mira', status: 'todo', created_at: '2026-09-17', assignee: demoUsers[1] },
  { id: 'HK-110', title: 'Stripe Webhook Sandbox Mocking', description: 'Generate instant test checkout receipts without waiting on the live test clock.', assignee_id: 'sasha', status: 'todo', created_at: '2026-09-17', assignee: demoUsers[3] },
  { id: 'HK-104', title: 'SSE Stream Response Engine', description: 'Wire the streaming route directly into the mobile token reader.', assignee_id: 'devin', status: 'in_progress', created_at: '2026-09-16', assignee: demoUsers[2] },
  { id: 'HK-105', title: 'Dynamic Prompt Weight Tuner', description: 'Tune deterministic JSON generation for the final judge flow.', assignee_id: 'alex', status: 'in_progress', created_at: '2026-09-16', assignee: demoUsers[0] },
  { id: 'HK-101', title: 'Interactive Touch Heatmap', description: 'Let judges tap nodes and simulate latency bottlenecks.', assignee_id: 'mira', status: 'done', created_at: '2026-09-15', assignee: demoUsers[1] },
  { id: 'HK-102', title: 'Initialize Tailwind Design Tokens', description: 'Lock in the Obsidian Telemetry visual language.', assignee_id: 'alex', status: 'done', created_at: '2026-09-15', assignee: demoUsers[0] },
]

const statusLabel: Record<Status, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', blocked: 'Blocked' }

function App() {
  const [user, setUser] = useState<User | null>(isSupabaseConfigured ? null : demoUsers[0])
  const [tasks, setTasks] = useState<Task[]>(demoTasks)
  const [view, setView] = useState<View>('kanban')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [showAuth, setShowAuth] = useState(isSupabaseConfigured)
  const [showCreate, setShowCreate] = useState(false)
  const [online, setOnline] = useState(!isSupabaseConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) loadProfile(data.user.id)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id)
      else setShowAuth(true)
    })
    return () => authListener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !user) return
    const client = supabase
    const channel = client.channel('hacksync-tasks').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, loadTasks).subscribe((status) => setOnline(status === 'SUBSCRIBED'))
    return () => { client.removeChannel(channel) }
  }, [user])

  async function loadProfile(id: string) {
    const { data } = await supabase!.from('users').select('*').eq('id', id).single()
    if (data) { setUser(data); setShowAuth(false); loadTasks() }
  }

  async function loadTasks() {
    if (!supabase) return
    const { data } = await supabase.from('tasks').select('*, assignee:users(*)').order('created_at', { ascending: false })
    if (data) setTasks(data as Task[])
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget); const email = String(form.get('email')); const password = String(form.get('password')); const name = String(form.get('name') || email.split('@')[0])
    if (!supabase) { setUser({ id: 'demo', name, role: 'lead', avatar_initials: name.slice(0, 2).toUpperCase() }); setShowAuth(false); return }
    const result = authMode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { data: { name } } })
    if (result.error) setError(result.error.message); else if (authMode === 'signup') setError('Check your email to confirm your account.')
  }

  async function updateTask(id: string, status: Status) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    if (supabase) await supabase.from('tasks').update({ status }).eq('id', id)
  }

  async function createTask(title: string, description: string, assigneeId: string) {
    const assignee = demoUsers.find((member) => member.id === assigneeId) ?? user ?? demoUsers[0]
    const task: Task = { id: `HK-${Math.floor(Math.random() * 900 + 100)}`, title, description, assignee_id: assignee.id, status: 'todo', created_at: new Date().toISOString(), assignee }
    setTasks((current) => [task, ...current])
    if (supabase) await supabase.from('tasks').insert({ title, description, assignee_id: assignee.id })
    setShowCreate(false)
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setUser(null); setShowAuth(true) }

  async function signInWithGoogle() {
    setError('')
    if (!supabase) {
      setError('Google sign-in needs Supabase configuration in .env.')
      return
    }
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (oauthError) setError(oauthError.message)
  }

  if (showAuth || !user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} onGoogleSignIn={signInWithGoogle} error={error} />
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Zap size={17} /></div><div><strong>HACKSYNC</strong><span>TEAM WAR ROOM</span></div></div>
      <nav className="view-switcher"><button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}><LayoutDashboard size={15} /> Board</button><button className={view === 'focus' ? 'active' : ''} onClick={() => setView('focus')}><Target size={15} /> Focus</button></nav>
      <div className="top-actions"><span className="live-status"><i className={online ? 'pulse' : ''} /> {online ? 'LIVE SYNC' : 'LOCAL DEMO'}</span><button className="avatar" title="Sign out" onClick={signOut}>{user.avatar_initials}<span className="online-dot" /></button></div>
    </header>
    <main className="workspace">
      <section className="sprint-banner"><div className="banner-icon"><Bolt size={18} /></div><div><div className="eyebrow">SPRINT VELOCITY <span>• {tasks.filter((task) => task.status !== 'done').length}/{tasks.length} TASKS ACTIVE</span></div><strong>Dev War Room // Demo Ready</strong></div>{user.role === 'lead' && <button className="secondary-button" onClick={() => setShowCreate(true)}><Plus size={15} /> TASK</button>}</section>
      {view === 'kanban' ? <Kanban tasks={tasks} onUpdate={updateTask} onCreate={() => setShowCreate(true)} canCreate={user.role === 'lead'} /> : <Focus tasks={tasks} user={user} onUpdate={updateTask} onCreate={() => setShowCreate(true)} canCreate={user.role === 'lead'} />}
    </main>
    {showCreate && <CreateModal members={demoUsers} onClose={() => setShowCreate(false)} onCreate={createTask} />}
  </div>
}

function AuthScreen({ mode, setMode, onSubmit, onGoogleSignIn, error }: { mode: 'login' | 'signup'; setMode: (mode: 'login' | 'signup') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onGoogleSignIn: () => void; error: string }) {
  return <div className="auth-shell"><div className="auth-panel"><div className="brand auth-brand"><div className="brand-mark"><Zap size={17} /></div><div><strong>HACKSYNC</strong><span>TEAM WAR ROOM</span></div></div><div className="auth-copy"><span className="eyebrow">{mode === 'login' ? 'AUTHENTICATE OPERATOR' : 'REGISTER OPERATOR'}</span><h1>Ship the demo.<br /><em>Stay in sync.</em></h1><p>Real-time task coordination for teams building under pressure.</p></div><button className="google-button" type="button" onClick={onGoogleSignIn}><Chrome size={16} /> CONTINUE WITH GOOGLE</button><div className="auth-divider"><span>OR USE EMAIL</span></div><form className="auth-form" onSubmit={onSubmit}>{mode === 'signup' && <label>DISPLAY NAME<input name="name" required placeholder="Alex Liu" /></label>}<label>EMAIL ADDRESS<input name="email" type="email" required placeholder="you@team.dev" /></label><label>PASSWORD<input name="password" type="password" required minLength={6} placeholder="••••••••" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === 'login' ? 'ENTER WAR ROOM' : 'CREATE OPERATOR'} <ArrowRight size={16} /></button></form><button className="text-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Need access? Create an account' : 'Already have access? Sign in'}</button><div className="auth-foot"><Radio size={14} /> {isSupabaseConfigured ? 'Encrypted Supabase session' : 'Preview mode · add Supabase keys to activate auth'}</div></div><div className="auth-aside"><div className="signal-orbit"><div className="orbit-core"><Zap size={35} /></div><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div><p>EVERY SECOND COUNTS</p><span>Live state. One shared source of truth.</span></div></div>
}

function Kanban({ tasks, onUpdate, onCreate, canCreate }: { tasks: Task[]; onUpdate: (id: string, status: Status) => void; onCreate: () => void; canCreate: boolean }) {
  const columns: Status[] = ['todo', 'in_progress', 'done']
  return <div className="screen-content"><div className="screen-heading"><div><span className="eyebrow">MISSION CONTROL / BOARD</span><h1>Team Tasks</h1><p>Move fast. Keep the whole room calibrated.</p></div>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={16} /> NEW TASK</button>}</div><div className="mobile-tabs">{columns.map((status) => <span key={status}>{statusLabel[status].toUpperCase()} <b>{tasks.filter((task) => task.status === status).length}</b></span>)}</div><div className="kanban-grid">{columns.map((status) => <div className="kanban-column" key={status}><div className="column-heading"><div><i className={`status-dot ${status}`} /><span>{statusLabel[status].toUpperCase()}</span><b>{tasks.filter((task) => task.status === status).length}</b></div><small>{status === 'in_progress' ? 'LIVE' : status === 'done' ? 'VERIFIED' : 'QUEUE'}</small></div><div className="task-stack">{tasks.filter((task) => task.status === status).map((task) => <TaskCard key={task.id} task={task} onUpdate={onUpdate} />)}</div></div>)}</div></div>
}

function TaskCard({ task, onUpdate }: { task: Task; onUpdate: (id: string, status: Status) => void }) {
  const nextStatus: Status = task.status === 'todo' || task.status === 'blocked' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo'
  return <article className={`task-card ${task.status}`}><div className="task-meta"><span>{task.id}</span><StatusPill status={task.status} /></div><h3>{task.title}</h3><p>{task.description}</p><div className="task-footer"><div className="assignee"><span className="avatar small">{task.assignee?.avatar_initials ?? '??'}</span><span>{task.assignee?.name ?? 'Unassigned'}<small>{task.assignee?.role === 'lead' ? 'Team Lead' : 'Team Member'}</small></span></div>{task.status !== 'done' && <button className="card-action" onClick={() => onUpdate(task.id, nextStatus)}>{task.status === 'in_progress' ? 'DONE' : 'START'} <ArrowRight size={13} /></button>}{task.status === 'done' && <CheckCircle2 size={18} className="done-icon" />}</div></article>
}

function Focus({ tasks, user, onUpdate, onCreate, canCreate }: { tasks: Task[]; user: User; onUpdate: (id: string, status: Status) => void; onCreate: () => void; canCreate: boolean }) {
  const mine = useMemo(() => tasks.filter((task) => task.assignee_id === user.id || (!task.assignee_id && user.id === 'demo')), [tasks, user.id]); const complete = mine.filter((task) => task.status === 'done').length; const percent = mine.length ? Math.round((complete / mine.length) * 100) : 0
  return <div className="focus-sheet screen-content"><div className="focus-banner"><span><i className="status-dot in_progress" /> SPRINT ROOM • WEEK 2 DEMO</span><b>CALM MODE</b></div><div className="screen-heading"><div><span className="eyebrow">PERSONAL EXECUTION LOOP</span><h1>Today's Focus <em>// MVP</em></h1><p>{mine.length - complete} tasks remaining for demo <span className="impact-pill">HIGH IMPACT</span></p></div>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={16} /> ADD TASK</button>}</div><div className="progress-panel"><div><span>COMPLETION TRAJECTORY</span><strong>{percent}%</strong></div><div className="progress-track"><i style={{ width: `${percent}%` }} /></div><div><small>Safe, rapid implementation path</small><small>{complete} / {mine.length} COMPLETED</small></div></div><div className="focus-list">{mine.map((task) => <FocusTask key={task.id} task={task} onUpdate={onUpdate} />)}{!mine.length && <div className="empty-state">No tasks assigned to you yet. Ask the lead to route something your way.</div>}</div></div>
}

function FocusTask({ task, onUpdate }: { task: Task; onUpdate: (id: string, status: Status) => void }) { const done = task.status === 'done'; return <article className={`focus-task ${done ? 'is-done' : ''}`}><button className={`checkbox ${done ? 'checked' : ''}`} onClick={() => onUpdate(task.id, done ? 'todo' : 'done')} aria-label={done ? 'Reopen task' : 'Complete task'}>{done && <Check size={14} />}</button><div className="focus-task-copy"><strong>{task.title}</strong><span><i className="avatar tiny">{task.assignee?.avatar_initials}</i>{task.assignee?.name}</span></div><div className="focus-task-actions"><StatusPill status={task.status} />{!done && <button className={`flag-button ${task.status === 'blocked' ? 'flagged' : ''}`} onClick={() => onUpdate(task.id, task.status === 'blocked' ? 'todo' : 'blocked')}><Ban size={13} /> {task.status === 'blocked' ? 'UNBLOCK' : 'BLOCK'}</button>}</div></article> }

function StatusPill({ status }: { status: Status }) { return <span className={`status-pill ${status}`}><i className="status-dot" />{statusLabel[status]}</span> }
function CreateModal({ members, onClose, onCreate }: { members: User[]; onClose: () => void; onCreate: (title: string, description: string, assigneeId: string) => void }) { const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [assignee, setAssignee] = useState(members[0].id); return <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate(title.trim(), description.trim(), assignee) }}><div className="modal-heading"><div><span className="eyebrow">MISSION CONTROL</span><h2>Deploy a task</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>TASK TITLE<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Wire live judge demo" autoFocus /></label><label>DESCRIPTION<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does done look like?" rows={3} /></label><label>ASSIGN TO<div className="select-wrap"><select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select><ChevronDown size={15} /></div></label><div className="modal-actions"><button type="button" className="secondary-button wide" onClick={onClose}>CANCEL</button><button className="primary-button wide" type="submit"><Zap size={15} /> DEPLOY TASK</button></div></form></div> }

export default App
