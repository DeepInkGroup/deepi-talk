'use client';
import {useState} from 'react';

export default function AuthForm({onAuthenticated}:{onAuthenticated:()=>Promise<void>}) {
  const [register,setRegister]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    try{
      const response=await fetch('/api/auth/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
      const data=await response.json() as {error?:string};
      if(!response.ok)throw new Error(data.error||'Could not sign in. Try again.');
      await onAuthenticated();
    }catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  return <div className="auth-panel"><form className="profile-form" onSubmit={submit}>
    <label>EMAIL<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} disabled={busy}/></label>
    <label>PASSWORD<input name="password" type="password" autoComplete={register?'new-password':'current-password'} placeholder={register?'At least 10 characters':'Your password'} minLength={register?10:1} maxLength={128} required disabled={busy}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary wide" disabled={busy}>{busy?'Please wait...':register?'Create account':'Sign in'}</button>
  </form><button className="auth-switch" disabled={busy} onClick={()=>{setRegister(value=>!value);setError('');}}>{register?'Already here? Sign in':'New here? Create an account'}</button></div>;
}
