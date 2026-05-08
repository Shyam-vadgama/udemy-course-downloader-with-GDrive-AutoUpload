chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.msg === "getCourseInfo") {
    const courseUrl = window.location.href;
    const courseTitle = document.querySelector("h1.clp-lead__title")?.textContent || "";

    sendResponse({
      url: courseUrl,
      title: courseTitle,
      isCoursePage: courseUrl.includes("/course/"),
    });
  }
});
