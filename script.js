const navigationLinks = [...document.querySelectorAll('nav a')];
const sections = navigationLinks.map(link => document.querySelector(link.getAttribute('href')));
function updateNavigation() {
  let activeSection = sections[0];
  const threshold = document.querySelector('.masthead').offsetHeight + 100;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= threshold) activeSection = section;
  }
  for (const link of navigationLinks) {
    const isActive = link.getAttribute('href') === `#${activeSection.id}`;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('scroll', updateNavigation, { passive: true });
window.addEventListener('resize', updateNavigation);
updateNavigation();
