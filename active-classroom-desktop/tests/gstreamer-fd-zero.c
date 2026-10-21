#include <gst/gst.h>
#include <glib/gstdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include "gstsparsefile.h"

int main(int argc, char **argv) {
  const gboolean baseline = argc > 1 && strcmp(argv[1], "baseline") == 0;
  gst_init(NULL, NULL);
  char path[] = "/tmp/classroom-gstreamer-fd-XXXXXX";
  close(STDIN_FILENO);
  const int fd = g_mkstemp(path);
  g_assert_cmpint(fd, ==, STDIN_FILENO);
  GstSparseFile *file = gst_sparse_file_new();
  const gboolean accepted = gst_sparse_file_set_fd(file, fd);
  if (baseline) {
    g_assert_false(accepted); close(fd);
  } else {
    g_assert_true(accepted);
    const char bytes[] = "archivo verificado"; char actual[sizeof(bytes)] = {0};
    gsize available = 0; GError *error = NULL;
    g_assert_cmpuint(gst_sparse_file_write(file, 0, bytes, sizeof(bytes), &available, &error), ==, sizeof(bytes));
    g_assert_no_error(error);
    g_assert_cmpuint(gst_sparse_file_read(file, 0, actual, sizeof(actual), &available, &error), ==, sizeof(actual));
    g_assert_no_error(error); g_assert_cmpmem(bytes, sizeof(bytes), actual, sizeof(actual));
  }
  gst_sparse_file_free(file); g_unlink(path);
  g_print("GST_FD_ZERO_TEST baseline=%s valid_descriptor_zero=%s\n", baseline ? "true" : "false", accepted ? "accepted" : "rejected");
  return 0;
}
