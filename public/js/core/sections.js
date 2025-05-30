export function showSection(id){
  document.querySelectorAll('section[id$="-section"]').forEach(sec=>{
    sec.classList.toggle('hidden', !sec.id.startsWith(id));
  });
}

export function registerNav(btnId, section){
  document.getElementById(btnId)
          .addEventListener('click', ()=> showSection(section));
}
