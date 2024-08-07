document.addEventListener('DOMContentLoaded', () => {
    const sentMessage = document.getElementById('sent-message');
    const complexissuesForm = document.getElementById('complex-issues');

    complexissuesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(complexissuesForm);
        const response = await fetch('/submit-issue', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(Object.fromEntries(formData))
        });
        const result = await response.text();
        if (result === 'Message sent.') {
            displayMessage(sentMessage, result); // Display signup success message
        } else {
            displayError(sentMessage, result); // Display signup error message
        }
    });

    function displayError(element, message) {
        element.textContent = message;
        element.style.display = 'block';
        setTimeout(() => {
            element.textContent = '';
            element.style.display = 'none';
        }, 5000); // Hide message after 5 seconds
    }

});

function toggleMenu() {
    var menu = document.getElementById('navMenu');
    if (menu.classList.contains('visible')) {
        menu.classList.remove('visible');
    } else {
        menu.classList.add('visible');
    }
}

function toggleFooter() {
    var footer = document.getElementById("footer");
    if (footer.style.display === "none") {
        footer.style.display = "block";
    } else {
        footer.style.display = "none";
    }
}

function scrollToYPosition(percentage) {
    const totalHeight = document.body.scrollHeight - window.innerHeight;
    const scrollPosition = totalHeight * (percentage / 100);
    window.scrollTo(0, scrollPosition);
}

function showMenu() {
    document.querySelector('.nav-menu').style.display = 'block';
}

function hideMenu() {
    document.querySelector('.nav-menu').style.display = 'none';
}

document.querySelector('.x-btn').addEventListener('click', hideMenu);

document.querySelector('.menu-button').addEventListener('click', showMenu);
