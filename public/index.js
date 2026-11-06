(function () {
  const $ = (id) => document.getElementById(id);

  typewriter($("story"), "全臺爆單！分清行政層級，把包裹準時送到！");

  const openBoard = setupBoard();
  $("boardBtn").addEventListener("click", openBoard);

  const dialog = $("loginDialog");
  $("rankedBtn").addEventListener("click", () => {
    $("loginError").textContent = "";
    dialog.showModal();
    $("studentId").focus();
  });
  $("loginClose").addEventListener("click", () => dialog.close());

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = $("loginSubmit");
    submit.disabled = true;
    $("loginError").textContent = "";
    try {
      const { student } = await api("/api/login", { studentId: $("studentId").value });
      sessionStorage.setItem("student", JSON.stringify(student));
      location.href = "game.html?mode=standard";
    } catch (err) {
      $("loginError").textContent = err.message;
      submit.disabled = false;
    }
  });
})();
