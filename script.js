// Sticky Navbar & Banner Logic
window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    const banner = document.querySelector('.offers-banner');

    if (window.scrollY > 50) {
        nav.classList.add('scrolled');
        if (banner) banner.style.transform = 'translateY(-100%)';
    } else {
        nav.classList.remove('scrolled');
        if (banner) banner.style.transform = 'translateY(0)';
    }
});

// Smooth Scroll for Navigation Links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// Simple Scroll Animation Observer
const observerOptions = {
    threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// FAQ Accordion
document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
        const item = question.parentElement;
        item.classList.toggle('active');

        // Close other items
        document.querySelectorAll('.faq-item').forEach(otherItem => {
            if (otherItem !== item) {
                otherItem.classList.remove('active');
            }
        });
    });
});

document.querySelectorAll('.service-card, .offer-card, .testimonial-card, .about > div, .faq-item, .contact-section').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
});
