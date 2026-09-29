let selectedRole='desa';
document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-demo]').forEach(x=>x.classList.remove('selected'));button.classList.add('selected');selectedRole=button.dataset.demo}));
document.querySelectorAll('.show-pass').forEach(button=>button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.target);input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'Lihat':'Sembunyikan'}));
document.getElementById('loginForm')?.addEventListener('submit',event=>{event.preventDefault();const button=event.currentTarget.querySelector('.submit');button.innerHTML='Memverifikasi akses…';button.disabled=true;setTimeout(()=>location.href=`index.html?role=${selectedRole}`,650)});
document.getElementById('accountForm')?.addEventListener('submit',event=>{event.preventDefault();document.getElementById('success').classList.add('show')});
